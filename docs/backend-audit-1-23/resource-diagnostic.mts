import {RingMmSchema} from '@designflow/shared';
const n=Number(process.argv[2]??1024), k=n/4;const ring=[];
for(let i=0;i<k;i++)ring.push({x:i,z:0});for(let i=0;i<k;i++)ring.push({x:k,z:i});for(let i=0;i<k;i++)ring.push({x:k-i,z:k});for(let i=0;i<k;i++)ring.push({x:0,z:k-i});
const t=performance.now(),result=RingMmSchema.safeParse(ring);console.log(JSON.stringify({vertices:n,bytes:Buffer.byteLength(JSON.stringify(ring)),valid:result.success,elapsedMs:performance.now()-t}));
