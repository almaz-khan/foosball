<script lang="ts">
	import { page } from '$app/state';
	import GameRow from '#lib/components/GameRow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const filtered = $derived(data.filter.player !== null || data.filter.from !== '' || data.filter.to !== '');

	/** The same filters, another page. */
	function withCursor(cursor: string | null): string {
		const q = new URLSearchParams(page.url.searchParams.toString());
		if (cursor) q.set('cursor', cursor);
		else q.delete('cursor');
		const s = q.toString();
		return s ? `?${s}` : '?';
	}
</script>

<svelte:head><title>Games · {page.data.member?.orgName ?? 'Foosball'}</title></svelte:head>

<div class="head">
	<h1>Games</h1>
	{#if page.data.can.record}<a class="secondary compact" href="/play">Record a game</a>{/if}
</div>

<form class="filters card" method="GET" data-sveltekit-keepfocus>
	<label class="field">
		<span>Player</span>
		<select name="player" value={data.filter.player ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
			<option value="">Everyone</option>
			{#each data.players as p (p.id)}
				<option value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>
			{/each}
		</select>
	</label>
	<label class="field">
		<span>From</span>
		<input type="date" name="from" value={data.filter.from} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
	</label>
	<label class="field">
		<span>To</span>
		<input type="date" name="to" value={data.filter.to} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
	</label>
	<noscript><button class="secondary">Filter</button></noscript>
	{#if filtered}<a class="clear" href="/games">Clear</a>{/if}
</form>

{#if data.games.length === 0}
	<p class="empty card">
		{#if filtered}No games match these filters.{:else}No games yet.{#if page.data.can.record}{' '}<a href="/play">Record the first one.</a>{/if}{/if}
	</p>
{:else}
	<ul class="list card">
		{#each data.games as game (game.id)}
			<li><GameRow {game} playerId={data.filter.player} /></li>
		{/each}
	</ul>
{/if}

{#if data.next || data.paged}
	<nav class="pager" aria-label="Pages">
		{#if data.paged}<a href={withCursor(null)}>Newest</a>{:else}<span></span>{/if}
		{#if data.next}<a href={withCursor(data.next)}>Older games</a>{/if}
	</nav>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 14px;
	}
	h1 {
		margin: 0;
		font-size: 28px;
		letter-spacing: -0.02em;
	}
	.compact {
		width: auto;
		padding: 8px 14px;
		font-size: 15px;
	}
	.filters {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr auto;
		align-items: end;
		gap: 10px;
		padding: 12px;
		margin-bottom: 14px;
	}
	.clear {
		padding-bottom: 10px;
		font-size: 14px;
		color: var(--accent);
	}
	@media (max-width: 600px) {
		.filters {
			grid-template-columns: 1fr 1fr;
		}
		.filters label:first-child {
			grid-column: 1 / -1;
		}
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
	.empty {
		padding: 24px 16px;
		margin: 0;
		color: var(--text-2);
		text-align: center;
	}
	.pager {
		display: flex;
		justify-content: space-between;
		padding: 14px 4px;
	}
	.pager a {
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
	}
</style>
