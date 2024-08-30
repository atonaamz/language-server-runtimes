import { RequestHandler, RequestType } from 'vscode-jsonrpc'
import { Connection } from 'vscode-languageserver'
import { ParameterStructures, CancellationToken, HandlerResult, ResponseError } from 'vscode-languageserver-protocol'

// The code here is how the two approaches could be presented to the servers.  The implementation
// would be moved from here and put under runtimes/, but in a hurry, I just put everything in this file.

// Don't pay too much attention to the RPC error handling as it is implemented, but I didn't go
// through it much to verify it is behaving as expected and wired up how it should be.

// This interface is for JSON-RPC direct calls.  There needs to be a second (maybe more) method
// at least for declaring client-side requests.  Didn't have time to do that here.
export interface Rpc {
    onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void
}

// The rest of this shows how embedded RPC could be implemented.
interface EmbeddedRpcCallParams {
    method: string
    params: any
}

interface EmbeddedRpcCallResult {
    result: any
}

interface EmbeddedRpcCallError {
    error: any
}

const embeddedRpcCallType = new RequestType<EmbeddedRpcCallParams, EmbeddedRpcCallResult, EmbeddedRpcCallError>(
    '/aws/embeddedRpcCall',
    ParameterStructures.auto
)

export class EmbeddedRpc {
    private readonly handlers = new Map<string, (params: any, token: CancellationToken) => any>()

    // Connection shouldn't be exposed here, just doing so that server can send window.showInformationMessage
    constructor(public readonly connection: Connection) {
        this.connection.onRequest<EmbeddedRpcCallParams, EmbeddedRpcCallResult, EmbeddedRpcCallError>(
            embeddedRpcCallType,
            this.onEmbeddedRpcCall.bind(this)
        )
    }

    // This handler takes all client-to-server embedded RPC calls, unpacks them and passes the unpacked params
    // on to the intended call.  The result is packed and returned to the client.
    private onEmbeddedRpcCall(
        params: EmbeddedRpcCallParams,
        token: CancellationToken
    ): HandlerResult<EmbeddedRpcCallResult, EmbeddedRpcCallError> {
        try {
            const handler = this.handlers.get(params.method)
            return { result: handler!(params.params, token) }
        } catch (e) {
            // Yes, this could be any error, not necessarily E, can be sorted out later
            return new ResponseError(-1, 'Embedded RPC error', { error: e })
        }
    }

    // Declare client-to-server requests
    public on<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void {
        this.handlers.set(type.method, handler)
    }

    // Declare server-to-client requests.  This will create a stub that can be stored and called like a
    // regular function. It does nothing in the way of error handling right now.
    public stub<P, R, E>(type: RequestType<P, R, E>): (params: P, token?: CancellationToken) => Promise<R> {
        return async (params: P, token?: CancellationToken): Promise<R> => {
            return (
                await this.connection.sendRequest<EmbeddedRpcCallParams, EmbeddedRpcCallResult, EmbeddedRpcCallError>(
                    embeddedRpcCallType,
                    {
                        method: type.method,
                        params: params,
                    },
                    token
                )
            ).result
        }
    }
}
