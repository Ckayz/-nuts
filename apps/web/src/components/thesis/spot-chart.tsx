"use client";

import { useEffect, useRef } from "react";

/**
 * BTC spot chart, ported from the mockup's `drawSpot()`
 * (docs/mockups/thesis-fun-mockup.html lines 499-525). Every constant, the
 * seeded pseudo-random walk, the entry pins and the axis labels are the
 * mockup's; only the token names changed (--x -> --tn-x).
 */
const ENTRIES: Array<[number, string, number]> = [
	[150, "MK", 1],
	[153, "DV", 1],
	[157, "0X", 0],
	[163, "JL", 1],
	[165, "RH", 0],
];
const X_LABELS = ["29 Aug", "31 Aug", "2 Sep", "4 Sep", "now"];

function draw(c: HTMLCanvasElement) {
	const css = getComputedStyle(document.documentElement);
	const tok = (n: string) => css.getPropertyValue(n).trim();

	const w = c.clientWidth || 800;
	const h = 220;
	c.width = w * 2;
	c.height = h * 2;
	const g = c.getContext("2d");
	if (!g) return;
	g.scale(2, 2);

	const n = 168;
	const pts: number[] = [];
	let p = 78100;
	let s = 7;
	function rnd() {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280 - 0.5;
	}
	for (let i = 0; i < n; i++) {
		p += rnd() * 420 + (i > 110 ? 18 : -2);
		pts.push(p);
	}
	pts[n - 1] = 79607;

	const lo = 73500;
	const hi = 81500;
	const padL = 8;
	const padR = 52;
	const padT = 10;
	const padB = 18;
	const X = (i: number) => padL + ((w - padL - padR) * i) / (n - 1);
	const Y = (v: number) =>
		padT + (h - padT - padB) * (1 - (v - lo) / (hi - lo));
	const at = (i: number) => pts[i] as number;

	g.strokeStyle = tok("--tn-l");
	g.lineWidth = 1;
	for (const v of [74000, 76000, 78000, 80000]) {
		g.beginPath();
		g.moveTo(padL, Y(v));
		g.lineTo(w - padR, Y(v));
		g.stroke();
		g.fillStyle = tok("--tn-dim");
		g.font = `10px ${tok("--tn-mono")}`;
		g.textAlign = "left";
		g.fillText(`${v / 1000}k`, w - padR + 6, Y(v) + 3);
	}

	function dash(v: number, col: string) {
		if (!g) return;
		g.save();
		g.setLineDash([4, 4]);
		g.strokeStyle = col;
		g.lineWidth = 1;
		g.beginPath();
		g.moveTo(padL, Y(v));
		g.lineTo(w - padR, Y(v));
		g.stroke();
		g.restore();
	}
	dash(78000, tok("--tn-bear-fill"));
	dash(74000, tok("--tn-dim"));

	const grad = g.createLinearGradient(0, padT, 0, h);
	grad.addColorStop(0, "rgba(245,197,66,.16)");
	grad.addColorStop(1, "rgba(245,197,66,0)");
	g.beginPath();
	g.moveTo(X(0), Y(at(0)));
	for (let i = 1; i < n; i++) g.lineTo(X(i), Y(at(i)));
	g.lineTo(X(n - 1), h - padB);
	g.lineTo(X(0), h - padB);
	g.closePath();
	g.fillStyle = grad;
	g.fill();

	g.beginPath();
	g.moveTo(X(0), Y(at(0)));
	for (let i = 1; i < n; i++) g.lineTo(X(i), Y(at(i)));
	g.strokeStyle = tok("--tn-k");
	g.lineWidth = 1.6;
	g.stroke();

	for (const e of ENTRIES) {
		const [idx, label, isBull] = e;
		const x = X(idx);
		const y = Y(at(idx));
		g.beginPath();
		g.arc(x, y, 8, 0, Math.PI * 2);
		g.fillStyle = isBull ? tok("--tn-bull-fill") : tok("--tn-bear-fill");
		g.fill();
		g.lineWidth = 2;
		g.strokeStyle = tok("--tn-s");
		g.stroke();
		g.fillStyle = isBull ? "#04130a" : "#fff";
		g.font = `700 7px ${tok("--tn-sans")}`;
		g.textAlign = "center";
		g.fillText(label, x, y + 2.5);
	}

	g.beginPath();
	g.arc(X(n - 1), Y(at(n - 1)), 3.5, 0, Math.PI * 2);
	g.fillStyle = tok("--tn-acc");
	g.fill();

	g.fillStyle = tok("--tn-dim");
	g.font = `10px ${tok("--tn-mono")}`;
	g.textAlign = "center";
	X_LABELS.forEach((t, k) => {
		g.fillText(t, X(Math.round((k * (n - 1)) / 4)), h - 4);
	});
}

export function SpotChart({ label }: { label: string }) {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const c = ref.current;
		if (c) draw(c);
	}, []);

	return (
		<canvas ref={ref} width={800} height={220} aria-label={label} role="img" />
	);
}
