/** Exact, reduced rational arithmetic. No global Decimal state or floating totals. */
export class Rational {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (d === 0n) throw new Error('Zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    let a = n < 0n ? -n : n, b = d;
    while (b) { const r = a % b; a = b; b = r; }
    this.n = n / a; this.d = d / a;
  }
  static from(value: string | number | bigint) {
    const s = String(value);
    if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(s)) throw new Error('Expected an exact decimal');
    const digits = s.split('.')[1]?.length ?? 0;
    return new Rational(BigInt(s.replace('.','')), 10n ** BigInt(digits));
  }
  add(v: Rational) { return new Rational(this.n*v.d+v.n*this.d,this.d*v.d); }
  sub(v: Rational) { return new Rational(this.n*v.d-v.n*this.d,this.d*v.d); }
  mul(v: Rational) { return new Rational(this.n*v.n,this.d*v.d); }
  div(v: Rational) { return new Rational(this.n*v.d,this.d*v.n); }
  cmp(v: Rational) { const n=this.n*v.d-v.n*this.d; return n<0n ? -1 : n>0n ? 1 : 0; }
  ceil() { if (this.n < 0n) throw new Error('Negative requirement'); return (this.n+this.d-1n)/this.d; }
  decimal(places: number) {
    if (this.n < 0n) throw new Error('Negative requirement');
    const scale=10n**BigInt(places), rounded=(this.n*scale*2n+this.d)/(2n*this.d);
    const s=rounded.toString().padStart(places+1,'0');
    return places ? `${s.slice(0,-places)}.${s.slice(-places)}`.replace(/\.?0+$/,'') : s;
  }
  exact() { return { numerator: this.n.toString(), denominator: this.d.toString() }; }
}
export const R = Rational.from;
export function convertPhysical(value: string, from: 'mm2'|'m2'|'mm3'|'m3'|'ml'|'l'|'g'|'kg', to: typeof from): Rational {
  const dimensions = { mm2:'area',m2:'area',mm3:'volume',m3:'volume',ml:'liquid',l:'liquid',g:'mass',kg:'mass' };
  const scales = { mm2:'1000000',m2:'1',mm3:'1000000000',m3:'1',ml:'1000',l:'1',g:'1000',kg:'1' };
  if (dimensions[from] !== dimensions[to]) throw new Error('Incompatible physical units');
  return R(value).div(R(scales[from])).mul(R(scales[to]));
}
