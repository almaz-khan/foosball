<script lang="ts">
	import GameRow from '#lib/components/GameRow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const d = $derived(data.dashboard);
	const periods = [
		{ value: 'month', label: 'This month' },
		{ value: 'year', label: 'This year' },
		{ value: 'all', label: 'All time' }
	] as const;
	const pct = (rate: number | null) => (rate === null ? '–' : `${Math.round(rate * 100)}%`);
	const diff = (n: number) => (n > 0 ? `+${n}` : String(n));
	const ranked = $derived(d ? d.standings.filter((s) => !s.provisional) : []);
	const provisional = $derived(d ? d.standings.filter((s) => s.provisional) : []);
</script>

{#if !data.member || !d}
	<section class="card panel">
		<h1>No org yet</h1>
		<p class="sub">You’re signed in, but not a member of any org.</p>
		<p class="hint">Ask an org’s admin to send you an invite link.</p>
	</section>
{:else}
	<div class="head">
		<nav class="periods" aria-label="Period">
			{#each periods as p (p.value)}
				<a href={p.value === 'all' ? '/' : `/?period=${p.value}`} aria-current={d.period === p.value ? 'page' : undefined}>{p.label}</a>
			{/each}
		</nav>
		{#if data.can.record}<a class="primary compact" href="/play">Record a game</a>{/if}
	</div>

	{#if !data.member.playerName}
		<p class="note card">You can follow the games. To record them, ask an admin to link you to a player.</p>
	{/if}

	{#if d.games === 0}
		<p class="empty card">
			No games {d.period === 'all' ? 'yet' : d.period === 'month' ? 'this month' : 'this year'}.
			{#if data.can.record}<a href="/play">Record one.</a>{/if}
		</p>
	{:else}
		{#if d.me}
			<section class="me card" aria-label="Your record">
				<div><strong>{d.me.played}</strong><span>played</span></div>
				<div><strong>{pct(d.me.winRate)}</strong><span>won</span></div>
				<div><strong>{diff(d.me.goalsFor - d.me.goalsAgainst)}</strong><span>goal diff</span></div>
				<div class="partner">
					<strong>{d.me.bestPartner?.name ?? '–'}</strong>
					<span>{d.me.bestPartner ? `best partner · ${d.me.bestPartner.won}/${d.me.bestPartner.played} won` : 'best partner (3+ games together)'}</span>
				</div>
			</section>
		{/if}

		<section class="card standings">
			<h2>Standings <small>{d.games} {d.games === 1 ? 'game' : 'games'}</small></h2>
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th class="rank">#</th>
							<th class="name">Player</th>
							<th>P</th>
							<th>W</th>
							<th>L</th>
							<th>Win</th>
							<th class="wide">Goals</th>
							<th>±</th>
							<th class="wide pos" title="Won as offense / defense">Off · Def</th>
							<th class="wide name">Best partner</th>
						</tr>
					</thead>
					<tbody>
						{#each ranked as s, i (s.playerId)}
							{@render row(s, String(i + 1))}
						{/each}
						{#if provisional.length}
							<tr class="divider"><td colspan="10">Fewer than 3 games</td></tr>
							{#each provisional as s (s.playerId)}
								{@render row(s, '')}
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</section>

		<section class="recent">
			<div class="recent-head">
				<h2>Recent games</h2>
				<a href="/games">All games</a>
			</div>
			<ul class="list card">
				{#each d.recent as game (game.id)}
					<li><GameRow {game} playerId={data.member.playerId} /></li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

{#snippet row(s: NonNullable<typeof d>['standings'][number], rank: string)}
	<tr class:mine={s.playerId === data.member?.playerId}>
		<td class="rank">{rank}</td>
		<td class="name"><a href="/players/{s.playerId}">{s.name}</a></td>
		<td>{s.played}</td>
		<td>{s.won}</td>
		<td>{s.lost}</td>
		<td class="strong">{pct(s.winRate)}</td>
		<td class="wide">{s.goalsFor}:{s.goalsAgainst}</td>
		<td>{diff(s.goalsFor - s.goalsAgainst)}</td>
		<td class="wide pos">{s.asOffense.won}/{s.asOffense.played} · {s.asDefense.won}/{s.asDefense.played}</td>
		<td class="wide name">{s.bestPartner?.name ?? '–'}</td>
	</tr>
{/snippet}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 14px;
	}
	.periods {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 999px;
		background: var(--fill);
	}
	.periods a {
		padding: 6px 12px;
		border-radius: 999px;
		color: var(--text-2);
		font-size: 14px;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}
	.periods a[aria-current='page'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
	}
	.compact {
		width: auto;
		padding: 8px 14px;
		font-size: 15px;
		white-space: nowrap;
	}
	@media (max-width: 480px) {
		.head {
			flex-wrap: wrap;
		}
	}
	.note,
	.empty {
		margin: 0 0 14px;
		padding: 14px 16px;
		color: var(--text-2);
	}
	.empty {
		padding: 28px 16px;
		text-align: center;
	}
	.me {
		display: grid;
		grid-template-columns: repeat(3, auto) 1fr;
		gap: 4px 24px;
		align-items: end;
		padding: 16px 18px;
		margin-bottom: 14px;
	}
	.me div {
		display: grid;
	}
	.me strong {
		font-size: 24px;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.me span {
		font-size: 13px;
		color: var(--text-2);
	}
	.me .partner strong {
		font-size: 18px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 480px) {
		.me {
			grid-template-columns: repeat(3, 1fr);
		}
		.me .partner {
			grid-column: 1 / -1;
		}
	}
	h2 {
		margin: 0;
		font-size: 18px;
	}
	h2 small {
		margin-left: 6px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-2);
	}
	.standings {
		padding: 16px 0 6px;
		margin-bottom: 20px;
	}
	.standings h2 {
		padding: 0 16px 8px;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		font-size: 15px;
	}
	th,
	td {
		padding: 9px 8px;
		text-align: right;
		white-space: nowrap;
	}
	th {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	th:first-child,
	td:first-child {
		padding-left: 16px;
	}
	th:last-child,
	td:last-child {
		padding-right: 16px;
	}
	.rank {
		width: 1%;
		color: var(--text-2);
		text-align: left;
	}
	.name {
		text-align: left;
	}
	td.name a {
		color: var(--text);
		font-weight: 500;
		text-decoration: none;
	}
	td.name a:hover {
		text-decoration: underline;
	}
	.strong {
		font-weight: 700;
	}
	.pos {
		color: var(--text-2);
	}
	tbody tr {
		border-top: 1px solid var(--line);
	}
	tr.mine {
		background: color-mix(in srgb, var(--accent) 9%, transparent);
	}
	tr.divider td {
		padding-top: 14px;
		font-size: 12px;
		color: var(--text-2);
		text-align: left;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	@media (max-width: 600px) {
		.wide {
			display: none;
		}
	}
	.recent-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin: 0 4px 10px;
	}
	.recent-head a {
		color: var(--accent);
		text-decoration: none;
		font-size: 15px;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow: hidden;
	}
	.list li + li {
		border-top: 1px solid var(--line);
	}
</style>
