import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseFallback } from '../src/ai/fallback-parser.js';
import { initialConversation, planConversation } from '../src/ai/conversation-planner.js';
import { ConversationMessageSchema } from '../src/contracts/conversations.js';

const plan = (text: string) => planConversation(initialConversation(null, null, false), ConversationMessageSchema.parse({
  messageId: randomUUID(), expectedVersion: 0, baseRevisionId: null, text,
}));

describe('ordinary natural-language residential briefs', () => {
  it.each([
    { text: 'Create a two-floor house on a 30 m by 20 m plot with 3 bedrooms.', width: 30000, depth: 20000 },
    { text: 'Can you design a 3 BHK house on a 30 by 40 ft plot with two floors?', width: 9144, depth: 12192 },
    { text: 'Could you please build a two-storey 3-bedroom home on a 30 by 40 foot site?', width: 9144, depth: 12192 },
    { text: 'Would you create a house with 3 bedrooms and two floors on a 30 by 40 ft plot?', width: 9144, depth: 12192 },
  ])('prepares a proposal for "$text" without losing explicit dimensions or room counts', async ({ text, width, depth }) => {
    expect(parseFallback(text).unsupported).toEqual([]);
    const result = await plan(text);
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(result.questions).toEqual([]);
    expect(result.unsupported).toEqual([]);
    expect(result.proposal).not.toBeNull();
    expect(result.requirements?.floors).toBe(2);
    expect(result.requirements?.site.boundary).toEqual([{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }]);
    expect(result.requirements?.rooms.filter(room => room.type === 'bedroom').reduce((sum, room) => sum + room.count, 0)).toBe(3);
  });

  it.each(['a garden', 'glass walls', 'a photorealistic render', 'a walkthrough video', 'a swimming pool', 'a rooftop terrace'])(
    'keeps unsupported residual requirement "%s" blocking despite ordinary request wording', async extra => {
      const text = `Can you design a 3 BHK house on a 30 by 40 ft plot with two floors and ${extra}?`;
      expect(parseFallback(text).unsupported).toContain('unrecognized_language');
      const result = await plan(text);
      expect(result.status).toBe('NEEDS_CLARIFICATION');
      expect(result.unsupported).toContain('unrecognized_language');
      expect(result.proposal).toBeNull();
    });

  it('still blocks floor counts beyond the generator limit', async () => {
    const result = await plan('Can you design a 3 BHK house on a 30 by 40 ft plot with three floors?');
    expect(result.intent.floors).toBe(3);
    expect(result.status).toBe('NEEDS_CLARIFICATION');
    expect(result.proposal).toBeNull();
    expect(result.questions.join(' ')).toMatch(/one or two floors/i);
  });

  it('still detects known unsupported features and conditional constraints', async () => {
    const spiral = await plan('Please create a 3 BHK house on a 30 by 40 ft plot with two floors and a spiral staircase.');
    expect(spiral.unsupported).toContain('spiral_staircase');
    expect(spiral.proposal).toBeNull();
    const conditional = await plan('Could you design a house on a 30 by 40 ft plot with at least 3 bedrooms?');
    expect(conditional.unsupported).toContain('unsupported_constraint');
    expect(conditional.proposal).toBeNull();
  });
});
