/**
 * A tiny React function-component runner for tests.
 *
 * The money-path components (`TakeASide`, `TradeExecution`) hold their whole
 * send/record decision in hooks, and lane C round 2 shipped bugs that lived
 * exactly there — a pending `sign()` closure that outlived the side it was
 * quoted for, a sent fill kept only in component state. Those cannot be proven
 * by testing extracted pure functions: the bug IS the wiring. There is no DOM
 * library in this workspace (`bun pm ls` has no jsdom/happy-dom and the brief
 * forbids new packages), so this module runs the component FUNCTION with a
 * hand-rolled hook dispatcher and walks the element tree it returns.
 *
 * It is deliberately small and synchronous: no scheduler, no batching, no
 * concurrent rendering. Renders are driven explicitly by `flush()`, which is
 * what makes an adversarial probe reproducible ("resolve the requote, THEN
 * release the held preparation").
 */
import * as React from "react";
import type { ReactElement } from "react";

/**
 * React's own dispatcher slot. `useState` and friends exported from "react"
 * resolve through it on every call, which is how react-dom, react-dom/server
 * and the test renderers all install their hook implementations. Using it means
 * this harness needs no module mocking of "react" — module mocks in bun are
 * process-wide, and mocking "react" for one probe file broke four unrelated
 * component tests in the same run (measured 2026-09-05).
 */
const INTERNALS_SLOT = (React as unknown as Record<string, { H: unknown } | undefined>)
	.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
// Checked once, loudly: this runner drives real hooks through React's internal
// dispatcher slot, and a React version that renamed the property would otherwise
// fail somewhere far from the cause. (`noUncheckedIndexedAccess` is what made
// the possibility visible — CL-3.)
if (!INTERNALS_SLOT) {
	throw new Error("React does not expose __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE; the hook runner needs it");
}
const INTERNALS: { H: unknown } = INTERNALS_SLOT;

type Deps = readonly unknown[] | undefined;

interface Slot {
	kind: "state" | "ref" | "memo" | "effect" | "transition";
	value?: unknown;
	deps?: Deps;
	cleanup?: (() => void) | void;
}

let current: Instance | null = null;

function slot(kind: Slot["kind"]): Slot {
	const inst = current;
	if (inst === null) throw new Error("hook called outside a render");
	const existing = inst.slots[inst.cursor];
	if (existing === undefined) {
		const fresh: Slot = { kind };
		inst.slots[inst.cursor] = fresh;
		inst.cursor += 1;
		return fresh;
	}
	if (existing.kind !== kind) throw new Error(`hook order changed: expected ${existing.kind}, got ${kind}`);
	inst.cursor += 1;
	return existing;
}

function depsChanged(a: Deps, b: Deps): boolean {
	if (a === undefined || b === undefined) return true;
	if (a.length !== b.length) return true;
	return a.some((value, index) => !Object.is(value, b[index]));
}

function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
	const inst = current;
	if (inst === null) throw new Error("useState outside a render");
	const s = slot("state");
	if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => S)() : initial;
	const set = (next: S | ((prev: S) => S)) => {
		const value = typeof next === "function" ? (next as (prev: S) => S)(s.value as S) : next;
		if (Object.is(value, s.value)) return;
		s.value = value;
		inst.dirty = true;
	};
	return [s.value as S, set];
}

function useRef<T>(initial: T): { current: T } {
	const s = slot("ref");
	if (!("value" in s)) s.value = { current: initial };
	return s.value as { current: T };
}

function useCallback<T>(fn: T, deps: Deps): T {
	const s = slot("memo");
	if (!("value" in s) || depsChanged(s.deps, deps)) {
		s.value = fn;
		s.deps = deps;
	}
	return s.value as T;
}

function useMemo<T>(fn: () => T, deps: Deps): T {
	const s = slot("memo");
	if (!("value" in s) || depsChanged(s.deps, deps)) {
		s.value = fn();
		s.deps = deps;
	}
	return s.value as T;
}

function useEffect(fn: () => void | (() => void), deps: Deps): void {
	const inst = current;
	if (inst === null) throw new Error("useEffect outside a render");
	const s = slot("effect");
	const first = !("value" in s);
	if (first || depsChanged(s.deps, deps)) {
		s.deps = deps;
		s.value = true;
		inst.pendingEffects.push(s, fn as unknown as Slot);
	}
}

function useTransition(): [boolean, (fn: () => void | Promise<void>) => void] {
	const inst = current;
	if (inst === null) throw new Error("useTransition outside a render");
	const s = slot("transition");
	if (!("value" in s)) s.value = false;
	const start = (fn: () => void | Promise<void>) => {
		s.value = true;
		inst.dirty = true;
		let result: void | Promise<void>;
		try {
			result = fn();
		} catch (error) {
			s.value = false;
			inst.dirty = true;
			throw error;
		}
		if (result !== undefined && typeof (result as Promise<void>).then === "function") {
			inst.inFlight += 1;
			void (result as Promise<void>).then(
				() => {
					s.value = false;
					inst.dirty = true;
					inst.inFlight -= 1;
				},
				() => {
					s.value = false;
					inst.dirty = true;
					inst.inFlight -= 1;
				},
			);
			return;
		}
		s.value = false;
		inst.dirty = true;
	};
	return [s.value as boolean, start];
}

/** Anything an element tree can hold. */
type Node = ReactElement | string | number | boolean | null | undefined | Node[];

export interface Found {
	readonly type: unknown;
	readonly props: Record<string, unknown>;
	/** Every string in this element's subtree, joined by a single space. */
	readonly text: string;
}

function collectText(node: Node, out: string[]): void {
	if (node === null || node === undefined || typeof node === "boolean") return;
	if (typeof node === "string" || typeof node === "number") {
		const value = String(node).trim();
		if (value !== "") out.push(value);
		return;
	}
	if (Array.isArray(node)) {
		for (const child of node) collectText(child, out);
		return;
	}
	const props = (node as ReactElement).props as { children?: Node } | undefined;
	if (props !== undefined) collectText(props.children ?? null, out);
}

function walk(node: Node, visit: (element: ReactElement) => void): void {
	if (node === null || node === undefined || typeof node === "boolean") return;
	if (typeof node === "string" || typeof node === "number") return;
	if (Array.isArray(node)) {
		for (const child of node) walk(child, visit);
		return;
	}
	visit(node as ReactElement);
	const props = (node as ReactElement).props as { children?: Node } | undefined;
	if (props !== undefined) walk(props.children ?? null, visit);
}

/**
 * The hooks a client component in this app actually calls. Anything else throws
 * by name rather than returning undefined, so an untested hook cannot silently
 * make a probe pass.
 */
const DISPATCHER: Record<string, unknown> = new Proxy(
	{
		useState,
		useRef,
		useCallback,
		useMemo,
		useEffect,
		useLayoutEffect: useEffect,
		useInsertionEffect: useEffect,
		useTransition,
		useDebugValue: () => {},
		useId: () => ":probe:",
	} as Record<string, unknown>,
	{
		get(target, key) {
			if (key in target) return target[key as string];
			throw new Error(`hook-runner does not implement ${String(key)}`);
		},
	},
);

class Instance {
	slots: Slot[] = [];
	cursor = 0;
	dirty = false;
	inFlight = 0;
	pendingEffects: Slot[] = [];
	tree: Node = null;
	props: Record<string, unknown>;
	readonly component: (props: never) => ReactElement | null;

	constructor(component: (props: never) => ReactElement | null, props: Record<string, unknown>) {
		this.component = component;
		this.props = props;
	}

	render(): void {
		this.cursor = 0;
		this.dirty = false;
		const previous = current;
		const previousDispatcher = INTERNALS.H;
		current = this;
		INTERNALS.H = DISPATCHER;
		try {
			this.tree = this.component(this.props as never);
		} finally {
			current = previous;
			INTERNALS.H = previousDispatcher;
		}
		const effects = this.pendingEffects;
		this.pendingEffects = [];
		for (let i = 0; i < effects.length; i += 2) {
			const holder = effects[i];
			const fn = effects[i + 1] as unknown as () => void | (() => void);
			if (holder === undefined) continue;
			if (typeof holder.cleanup === "function") holder.cleanup();
			holder.cleanup = fn();
		}
	}
}

export interface Mounted {
	/** Re-render until no state write is pending (bounded, so a loop fails loudly). */
	flush(): void;
	/** Drain the microtask queue, then flush. Awaits settled promises the component started. */
	settle(): Promise<void>;
	/** Replace the props and re-render, keeping every hook — a prop change, not a remount. */
	setProps(props: Record<string, unknown>): void;
	find(predicate: (element: Found) => boolean): Found[];
	/** Every button in the tree, in document order. */
	buttons(): Found[];
	/** The first button whose text matches, or `null`. */
	button(text: string | RegExp): Found | null;
	/** Every string in the tree, joined — what the user can read. */
	text(): string;
	click(button: Found): void;
	unmount(): void;
}

export function mount(component: (props: never) => ReactElement | null, props: Record<string, unknown>): Mounted {
	const inst = new Instance(component, props);
	inst.render();
	let guard = 0;
	while (inst.dirty) {
		if (++guard > 50) throw new Error("render loop did not settle");
		inst.render();
	}

	const found = (element: ReactElement): Found => {
		const out: string[] = [];
		collectText(element, out);
		return { type: element.type, props: element.props as Record<string, unknown>, text: out.join(" ") };
	};

	const api: Mounted = {
		flush() {
			let n = 0;
			while (inst.dirty) {
				if (++n > 50) throw new Error("render loop did not settle");
				inst.render();
			}
		},
		async settle() {
			for (let i = 0; i < 20; i += 1) {
				await Promise.resolve();
				await new Promise((resolve) => setTimeout(resolve, 0));
				api.flush();
				if (!inst.dirty && inst.inFlight === 0) break;
			}
			api.flush();
		},
		setProps(next) {
			inst.props = next;
			inst.dirty = true;
			api.flush();
			inst.render();
			api.flush();
		},
		find(predicate) {
			const hits: Found[] = [];
			walk(inst.tree, (element) => {
				const candidate = found(element);
				if (predicate(candidate)) hits.push(candidate);
			});
			return hits;
		},
		buttons() {
			return api.find((element) => element.type === "button");
		},
		button(text) {
			const match = (value: string) => (typeof text === "string" ? value === text : text.test(value));
			return api.buttons().find((element) => match(element.text)) ?? null;
		},
		text() {
			const out: string[] = [];
			collectText(inst.tree, out);
			return out.join(" ");
		},
		click(button) {
			const onClick = button.props.onClick;
			if (typeof onClick !== "function") throw new Error(`"${button.text}" has no onClick`);
			if (button.props.disabled === true) throw new Error(`"${button.text}" is disabled`);
			(onClick as () => void)();
			api.flush();
		},
		unmount() {
			for (const s of inst.slots) if (typeof s.cleanup === "function") s.cleanup();
		},
	};
	return api;
}

/** A promise a test resolves by hand, so a probe can hold one leg open across another. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
