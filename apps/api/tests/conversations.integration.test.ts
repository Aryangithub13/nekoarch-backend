import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, createTestUser, asPrincipal } from '../../../test-support/postgres.js';
import { createPgBackend } from '../../../test-support/pg-backend.js';
import { conversationAcceptance } from '../../../test-support/conversation-acceptance.js';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

describe('Phase 20 real PostgreSQL conversation acceptance',()=>{
  let db:Awaited<ReturnType<typeof startTestDatabase>>,app:ReturnType<typeof buildApp>,ownerId:string,otherId:string;
  const owner={authorization:'Bearer owner'},other={authorization:'Bearer other'};
  beforeAll(async()=>{db=await startTestDatabase();ownerId=await createTestUser(db.pool);otherId=await createTestUser(db.pool);
    const secret=(await db.pool.query('select secret from project_private.commit_key')).rows[0].secret;
    app=buildApp({env:parseEnv({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'test',NODE_ENV:'test',LOG_LEVEL:'silent',RATE_LIMIT_ENABLED:'false',PROJECT_COMMIT_SECRET:secret}),backend:createPgBackend(db.pool,{owner:ownerId,other:otherId})});await app.ready();});
  afterAll(async()=>{await app?.close();await db?.stop();});
  conversationAcceptance(()=>({app,owner,other}),process.env.PHASE20_EXAMPLE_PATH);
  it('actual authenticated and anon SQL roles cannot forge writes or cross owner RLS',async()=>{
    expect((await asPrincipal(db.pool,otherId,c=>c.query('select * from architectural_conversations'))).rowCount).toBe(0);
    await expect(asPrincipal(db.pool,null,c=>c.query('select * from architectural_conversations'))).rejects.toMatchObject({code:'42501'});
    await expect(asPrincipal(db.pool,ownerId,c=>c.query("update architectural_conversations set state='{}'"))).rejects.toMatchObject({code:'42501'});
    await expect(asPrincipal(db.pool,ownerId,c=>c.query("select conversation_write('submit','{}',null,null)"))).rejects.toMatchObject({code:'42501'});
  });
});
