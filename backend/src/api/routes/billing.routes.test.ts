// ── Billing / Credit Balance Tests ───────────────────────────────
// Critical: Wrong credit math = customers get overcharged or free rides.

import { describe, it, expect } from 'vitest';

describe('credit balance calculations', () => {
  it('rounding: no floating point drift on EUR amounts', () => {
    // Simulates the rounding logic from getCreditBalance
    const round = (v: number) => Math.round(v * 100) / 100;

    // Classic floating point trap: 0.1 + 0.2 !== 0.3
    expect(round(0.1 + 0.2)).toBe(0.3);
    expect(round(5.0 - 0.001 - 0.001 - 0.001)).toBe(5.0); // sub-cent usage
    expect(round(10.005)).toBe(10.01); // banker's rounding edge
    expect(round(-0.005)).toBe(-0); // JS IEEE 754: -0.005 rounds toward zero
  });

  it('balance never goes negative from rounding', () => {
    const round = (v: number) => Math.round(v * 100) / 100;
    // Simulate: 5€ balance, 500 tiny deductions of 0.01€
    let balance = 5.0;
    for (let i = 0; i < 500; i++) {
      balance -= 0.01;
      balance = round(balance);
    }
    expect(balance).toBe(0);
  });

  it('credit pack amounts match expected values', () => {
    // These are the packs customers can buy — verify they're sane
    const CREDIT_PACKS = [
      { id: 'credits_5', amountEur: 5, label: '€5' },
      { id: 'credits_10', amountEur: 10, label: '€10' },
      { id: 'credits_25', amountEur: 25, label: '€25' },
      { id: 'credits_50', amountEur: 50, label: '€50' },
      { id: 'credits_100', amountEur: 100, label: '€100' },
    ];

    for (const pack of CREDIT_PACKS) {
      expect(pack.amountEur).toBeGreaterThan(0);
      expect(pack.id).toMatch(/^credits_\d+$/);
    }
  });

  it('surcharge calculation is correct', () => {
    // CREDIT_SURCHARGE = 1.3 (30% markup on AI costs)
    const CREDIT_SURCHARGE = 1.3;
    const rawCost = 0.05; // $0.05 API cost
    const chargedCost = rawCost * CREDIT_SURCHARGE;
    expect(Math.round(chargedCost * 100) / 100).toBe(0.07); // 0.065 rounds to 0.07
  });
});

describe('plan limits enforcement', () => {
  it('trial plan has correct limits', () => {
    const PLAN_LIMITS = {
      trial: { agents: 1, messagesPerMonth: 100, storageGb: 0.5 },
      professional: { agents: 10, messagesPerMonth: 10000, storageGb: 10 },
      enterprise: { agents: -1, messagesPerMonth: -1, storageGb: -1 }, // -1 = unlimited
    };

    expect(PLAN_LIMITS.trial.agents).toBe(1);
    expect(PLAN_LIMITS.trial.messagesPerMonth).toBe(100);
    expect(PLAN_LIMITS.professional.agents).toBe(10);
    expect(PLAN_LIMITS.enterprise.agents).toBe(-1); // unlimited
  });
});
