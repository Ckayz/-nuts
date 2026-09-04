/**
 * Payoff-at-expiry diagram, ported from the mockup's payoff IIFE
 * (docs/mockups/thesis-fun-mockup.html lines 526-545). Same viewBox, padding,
 * domains, gridlines, strike/spot rules, sampling step and break-even marker;
 * colours are read through the --tn-* tokens with inline styles because SVG
 * presentation attributes do not resolve var().
 */

const W = 400;
const H = 220;
const padL = 44;
const padR = 10;
const padT = 12;
const padB = 26;
const xlo = 70000;
const xhi = 84000;
const ylo = -4800;
const yhi = 4800;
const prem = 1000;
const maxp = 4612;
const K1 = 78000;
const K2 = 74000;
const be = 76120;
const SPOT = 79607;

const X = (v: number) => padL + ((W - padL - padR) * (v - xlo)) / (xhi - xlo);
const Y = (v: number) => padT + (H - padT - padB) * (1 - (v - ylo) / (yhi - ylo));

function bull(s: number) {
	if (s >= K1) return -prem;
	if (s <= K2) return maxp;
	return -prem + ((K1 - s) / (K1 - K2)) * (maxp + prem);
}

function paths() {
	let pb = "";
	let pr = "";
	for (let s = xlo; s <= xhi; s += 100) {
		const v = bull(s);
		pb += `${s === xlo ? "M" : "L"}${X(s).toFixed(1)} ${Y(v).toFixed(1)} `;
		pr += `${s === xlo ? "M" : "L"}${X(s).toFixed(1)} ${Y(-v).toFixed(1)} `;
	}
	return { pb, pr };
}

const Y_GRID = [-4000, -2000, 0, 2000, 4000];
const X_TICKS = [72000, 74000, 76000, 78000, 80000, 82000];

const tickStyle = { fontFamily: "var(--tn-mono)", fill: "var(--tn-dim)" };

export function PayoffChart({ label }: { label: string }) {
	const { pb, pr } = paths();
	return (
		<svg className="payoff" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
			{Y_GRID.map((v) => (
				<line
					key={`g${v}`}
					x1={padL}
					y1={Y(v)}
					x2={W - padR}
					y2={Y(v)}
					strokeWidth={1}
					style={{ stroke: v === 0 ? "var(--tn-l2)" : "var(--tn-l)" }}
				/>
			))}
			{Y_GRID.map((v) => (
				<text
					key={`gl${v}`}
					x={padL - 6}
					y={Y(v) + 3}
					fontSize="10"
					textAnchor="end"
					style={tickStyle}
				>
					{`${v > 0 ? "+" : ""}${v / 1000}k`}
				</text>
			))}
			{X_TICKS.map((v) => (
				<text
					key={`x${v}`}
					x={X(v)}
					y={H - 8}
					fontSize="10"
					textAnchor="middle"
					style={tickStyle}
				>
					{`${v / 1000}k`}
				</text>
			))}
			<line
				x1={X(K1)}
				y1={padT}
				x2={X(K1)}
				y2={H - padB}
				strokeWidth={1}
				strokeDasharray="3 4"
				style={{ stroke: "var(--tn-bear-fill)" }}
			/>
			<line
				x1={X(K2)}
				y1={padT}
				x2={X(K2)}
				y2={H - padB}
				strokeWidth={1}
				strokeDasharray="3 4"
				style={{ stroke: "var(--tn-dim)" }}
			/>
			<line
				x1={X(SPOT)}
				y1={padT}
				x2={X(SPOT)}
				y2={H - padB}
				strokeWidth={1}
				strokeDasharray="3 4"
				style={{ stroke: "var(--tn-acc)" }}
			/>
			<text
				x={X(SPOT)}
				y={padT - 2}
				fontSize="10"
				textAnchor="middle"
				style={{ fontFamily: "var(--tn-mono)", fill: "var(--tn-m)" }}
			>
				spot
			</text>
			<path
				d={pb}
				fill="none"
				strokeWidth={2.5}
				style={{ stroke: "var(--tn-bull-fill)" }}
			/>
			<path
				d={pr}
				fill="none"
				strokeWidth={2.5}
				opacity={0.85}
				style={{ stroke: "var(--tn-bear-fill)" }}
			/>
			<circle
				cx={X(be)}
				cy={Y(0)}
				r={4}
				strokeWidth={1.5}
				style={{ fill: "var(--tn-g)", stroke: "var(--tn-k)" }}
			/>
		</svg>
	);
}
