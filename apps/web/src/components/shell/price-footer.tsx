import { footerSource, marketPrices, marketsSource } from "@/mock/data";

export function PriceFooter() {
	return (
		<footer className="foot">
			{marketPrices.map((m) => (
				<span key={m.asset}>
					{m.asset} <b>{m.price}</b> <span className="bull">{m.change}</span>
				</span>
			))}
			<span>
				markets <b>{marketsSource}</b>
			</span>
			<span className="src">{footerSource}</span>
		</footer>
	);
}
