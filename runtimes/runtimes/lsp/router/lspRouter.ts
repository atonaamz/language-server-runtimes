import {
    CancellationToken,
    ExecuteCommandParams,
    InitializeError,
    InitializeParams,
    InitializeResult,
    RequestHandler,
    RequestType,
    ResponseError,
    TextDocumentSyncKind,
} from '../../../protocol'
import { Connection } from 'vscode-languageserver/node'
import { LspServer } from './lspServer'
import { mergeObjects } from './util'
import { Rpc, EmbeddedRpc } from '../../../server-interface/rpc'

export class LspRouter {
    public clientInitializeParams?: InitializeParams
    public servers: LspServer[] = []

    constructor(
        private readonly lspConnection: Connection,
        private name: string,
        private version?: string
    ) {
        lspConnection.onInitialize(this.initialize)
        lspConnection.onExecuteCommand(this.executeCommand)
    }

    initialize = async (
        params: InitializeParams,
        token: CancellationToken
    ): Promise<InitializeResult | ResponseError<InitializeError>> => {
        this.clientInitializeParams = params
        const defaultResponse: InitializeResult = {
            serverInfo: {
                name: this.name,
                version: this.version,
            },
            capabilities: {
                textDocumentSync: {
                    openClose: true,
                    change: TextDocumentSyncKind.Incremental,
                },
            },
        }

        let responsesList = await Promise.all(this.servers.map(s => s.initialize(params, token)))
        responsesList = responsesList.filter(r => r != undefined)
        if (responsesList.some(el => el instanceof ResponseError)) {
            return responsesList.find(el => el instanceof ResponseError) as ResponseError<InitializeError>
        }

        // Set up one-off RPCs, this is where each server gets to register one-off RPCs
        {
            const embeddedRpc = new EmbeddedRpc(this.lspConnection)
            using rpc = new LspRouterRpc(this.lspConnection)
            this.servers.map(s => s.rpcInitialize(rpc, embeddedRpc))
        }

        const resultList = responsesList as InitializeResult[]
        resultList.unshift(defaultResponse)
        return resultList.reduceRight((acc, curr) => {
            return mergeObjects(acc, curr)
        })
    }

    executeCommand = async (
        params: ExecuteCommandParams,
        token: CancellationToken
    ): Promise<any | undefined | null> => {
        for (const s of this.servers) {
            const [executed, result] = await s.tryExecuteCommand(params, token)
            if (executed) {
                return result
            }
        }
    }
}

// The object that is provided as "rpc" in the rpcInitializer call.  For the embedded RPC,
// see the ../../server-interface/rpc.ts file.
// This is disposable so it can be rendered useless after the rpcInitializer call
// so servers couldn't hang onto it and violate the lifecycle constraint.  However,
// I'm not sure that constraint is even warranted, so it's possible that this could
// be simplified.
class LspRouterRpc implements Rpc, Disposable {
    private isDisposed: boolean = false

    constructor(private readonly connection: Connection) {}

    [Symbol.dispose](): void {
        this.isDisposed = true
    }

    private throwOnDisposed() {
        if (this.isDisposed) {
            throw new Error('Object is disposed')
        }
    }

    public onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void {
        this.throwOnDisposed()
        this.connection.onRequest<P, R, E>(type, handler)
    }
}
