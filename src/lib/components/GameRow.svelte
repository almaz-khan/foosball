<script lang="ts">
	import { sideOf, type GameView } from '#lib/game-view.ts';

	let { game, playerId = null }: { game: GameView; playerId?: number | null } = $props();

	/** Seen from one player's side: won, lost or drew. */
	const result = $derived.by(() => {
		if (playerId === null) return null;
		const side = sideOf(game, playerId);
		if (!side) return null;
		return game.winner === null ? 'draw' : game.winner === side ? 'won' : 'lost';
	});
</script>

<a class="row" href="/games/{game.id}">
	<span class="when">
		{game.when}
		{#if result}<span class="result {result}">{result}</span>{/if}
	</span>
	<span class="side red" class:won={game.winner === 'red'}>
		<span class="names">
			<span title="Offense">{game.red.offense.name}</span>
			<span title="Defense">{game.red.defense.name}</span>
		</span>
	</span>
	<span class="score" aria-label="{game.red.score} to {game.blue.score}">
		<span class="red" class:won={game.winner === 'red'}>{game.red.score}</span><span class="dash">:</span><span
			class="blue"
			class:won={game.winner === 'blue'}>{game.blue.score}</span
		>
	</span>
	<span class="side blue" class:won={game.winner === 'blue'}>
		<span class="names">
			<span title="Offense">{game.blue.offense.name}</span>
			<span title="Defense">{game.blue.defense.name}</span>
		</span>
	</span>
</a>

<style>
	.row {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		grid-template-areas:
			'when when when'
			'red score blue';
		align-items: center;
		gap: 4px 12px;
		padding: 12px 16px;
		color: var(--text);
		text-decoration: none;
	}
	.row:hover {
		background: var(--fill);
	}
	.when {
		grid-area: when;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-2);
	}
	.side {
		min-width: 0;
		border-left: 3px solid currentColor;
		padding-left: 8px;
	}
	.side.red {
		grid-area: red;
		color: var(--red);
	}
	.side.blue {
		grid-area: blue;
		color: var(--blue);
		border-left: 0;
		border-right: 3px solid currentColor;
		padding: 0 8px 0 0;
		text-align: right;
	}
	.names {
		display: grid;
		color: var(--text);
		font-size: 15px;
	}
	.names span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.side.won .names {
		font-weight: 600;
	}
	.score {
		grid-area: score;
		font-size: 22px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		color: var(--text-2);
	}
	.score .won {
		color: var(--text);
	}
	.dash {
		margin: 0 4px;
	}
	.result {
		padding: 0 6px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.result.won {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
	}
	.result.lost {
		background: color-mix(in srgb, var(--bad) 15%, transparent);
		color: var(--bad);
	}
	.result.draw {
		background: var(--fill);
	}
</style>
