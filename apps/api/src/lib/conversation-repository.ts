import type { Repository } from './repository.js';
import { ApiError } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { signProjectCommit } from '../services/project-service.js';
export function conversationDatabaseError(error: {code?:string}): never {
  const mapped: Record<string,[number,string,string]> = {P2001:[404,'CONVERSATION_NOT_FOUND','Conversation not found'],P2002:[409,'PROPOSAL_CONFLICT','Conversation or proposal changed; reload and review'],P2003:[429,'CONVERSATION_LIMIT','Conversation resource limit reached'],P2004:[409,'MESSAGE_IN_PROGRESS','A message is being processed; retry later']};
  const match=error.code ? mapped[error.code] : undefined; if(match) throw new ApiError(...match); return projectDatabaseError(error);
}
export class ConversationRepository {
  constructor(private readonly repository: Repository, private readonly userId: string, private readonly secret?: string) {}
  read(action: 'get'|'list'|'replay',input: Record<string,unknown>) {
    if(!this.repository.conversationRpc) throw new ApiError(503,'CONVERSATIONS_UNAVAILABLE','Conversation persistence is unavailable');
    return this.repository.conversationRpc('conversation_read',{p_action:action,p_input:input});
  }
  write(action: 'create'|'reserve'|'finish'|'submit'|'approve-start'|'release'|'cancel-message'|'delete'|'advance'|'rebase',input: Record<string,unknown>) {
    if(!this.repository.conversationRpc || !this.secret) throw new ApiError(503,'CONVERSATIONS_UNAVAILABLE','Conversation persistence is not configured');
    const attestation=signProjectCommit(this.secret,this.userId,`conversation:${action}`,input);
    return this.repository.conversationRpc('conversation_write',{p_action:action,p_input:input,p_envelope:attestation.envelope,p_signature:attestation.signature});
  }
}
