import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initialConversation,planConversation} from '../../apps/api/src/ai/conversation-planner.ts';
import {normalizeBlueprintRequirements} from '@designflow/generator';
import {requirements} from '../../packages/blueprint-qa/tests/fixtures.ts';
type State=ReturnType<typeof initialConversation>;
type Input=Partial<Parameters<typeof planConversation>[1]>;
const rows:Record<string,unknown>[]=[];
const msg=(s:State,text:string,rest:Input={})=>({messageId:randomUUID(),expectedVersion:s.version,baseRevisionId:s.baseRevisionId,text,...rest});
async function turn(name:string,s:State,text:string,rest:Input={}){try{const next=await planConversation(s,msg(s,text,rest));rows.push({name,status:next.status,questions:next.questions,unsupported:next.unsupported,intent:next.intent,rooms:next.requirements?.rooms,site:next.requirements?.site.boundary});return next;}catch(e){rows.push({name,error:(e as Error).message});return s;}}
let s=initialConversation(null,null,false);s=await turn('mixed-unit-start',s,'10 m by 20 ft plot, 2 bedrooms');await turn('mixed-unit-correct-to-m',s,'i meant metres');
let c=initialConversation(null,null,false);c=await turn('contradictory-start',c,'10 by 12 m plot, 2 bedrooms, one floor and two floors');await turn('unrelated-seed-clears-contradiction',c,'seed next');await turn('explicit-answer-clears',c,'answer',{answers:[{field:'floors',value:1}]});
let d=initialConversation(null,normalizeBlueprintRequirements(requirements(2)),false);d=await turn('unresolved-bedroom-move',d,'move one bedroom upstairs');d=await turn('unrelated-seed-after-move',d,'seed next');await turn('native-rooms-resolve',d,'use these values',{nativeUpdate:{rooms:[{type:'bedroom',count:2,level:1},{type:'living',count:1,level:0},{type:'bathroom',count:1,level:0},{type:'kitchen',count:1,level:0}]}});
const n=initialConversation(null,normalizeBlueprintRequirements(requirements(1)),false);await turn('uppercase-singular-room',n,'KITCHEN 3 by 4 m');await turn('uppercase-plural-room',n,'BEDROOMS 3 by 4 m');await turn('lowercase-plural-room',n,'bedrooms 3 by 4 m');
const e=initialConversation(null,normalizeBlueprintRequirements(requirements(1)),false);await turn('remove-bathroom-zero',e,'zero bathrooms');
const f=initialConversation(null,normalizeBlueprintRequirements(requirements(2)),false);await turn('two-to-one-native-rooms',f,'one floor',{nativeUpdate:{rooms:[{type:'bedroom',count:2,level:0},{type:'living',count:1,level:0},{type:'bathroom',count:1,level:0},{type:'kitchen',count:1,level:0}]}});
writeFileSync(new URL('./evidence/conversation-diagnostics.json',import.meta.url),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.map(({name,status,questions,unsupported,error,intent,site})=>({name,status,questions,unsupported,error,intent,site})),null,2));
