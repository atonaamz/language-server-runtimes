import {
    CancellationToken,
    ExecuteCommandParams,
    InitializeError,
    InitializeParams,
    RequestHandler,
    ResponseError,
} from '../../../protocol'
import { PartialInitializeResult, PartialServerCapabilities } from '../../../server-interface/lsp'
import { EmbeddedRpc, Rpc } from '../../../server-interface/rpc'
import { asPromise } from './util'

// Added rpcIntiailzeHandler separate from the intializeHandler because:
// 1) Didn't want to add a new param to the existing function and break all servers
// 2) This is when I assumed all declarations should be done during initialization
//    to set LSP capabilities and dynamic registration was unnecessary and potentially
//    a bad idea (declare it upfront, no benefit to things coming and going at runtime, just risk)
// 3) The separate method allowed more fine-grained control when this happened in the intialize
//    process to ensure capabilities could be updated automatically (see LspRouter)
export class LspServer {
    private rpcInitializeHandler?: (rpc: Rpc, embeddedRpc: EmbeddedRpc) => void
    private initializeHandler?: RequestHandler<InitializeParams, PartialInitializeResult, InitializeError>
    private executeCommandHandler?: RequestHandler<ExecuteCommandParams, any | undefined | null, void>
    private serverCapabilities?: PartialServerCapabilities

    public setRpcInitializeHandler = (handler: (rpc: Rpc, embeddedRpc: EmbeddedRpc) => void): void => {
        this.rpcInitializeHandler = handler
    }

    public setInitializeHandler = (
        handler: RequestHandler<InitializeParams, PartialInitializeResult, InitializeError>
    ): void => {
        this.initializeHandler = handler
    }

    public setExecuteCommandHandler = (
        handler: RequestHandler<ExecuteCommandParams, any | undefined | null, void>
    ): void => {
        this.executeCommandHandler = handler
    }

    public rpcInitialize = (rpc: Rpc, embeddedRpc: EmbeddedRpc): void => {
        if (!this.rpcInitializeHandler) {
            return
        }

        this.rpcInitializeHandler(rpc, embeddedRpc)
    }

    public initialize = async (
        params: InitializeParams,
        token: CancellationToken
    ): Promise<PartialInitializeResult | ResponseError<InitializeError> | undefined> => {
        if (!this.initializeHandler) {
            return
        }

        const initializeResult = await asPromise(this.initializeHandler(params, token))
        if (!(initializeResult instanceof ResponseError)) {
            this.serverCapabilities = initializeResult.capabilities
        }

        return initializeResult
    }

    public tryExecuteCommand = async (
        params: ExecuteCommandParams,
        token: CancellationToken
    ): Promise<[boolean, any | undefined | null]> => {
        if (
            this.serverCapabilities?.executeCommandProvider?.commands.some(c => c === params.command) &&
            this.executeCommandHandler
        ) {
            const result = await asPromise(this.executeCommandHandler(params, token))
            return [true, result]
        }

        return [false, undefined]
    }
}
