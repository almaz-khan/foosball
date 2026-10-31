<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import GameRow from '#lib/components/GameRow.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let renaming = $state(false);
	const p = $derived(data.player);
</script>

<svelte:head><title>{p.name} · {page.data.member?.orgName ?? 'Foosball'}</title></svelte:head>

<a class="back" href="/players">← Players</a>

<section class="card profile">
	<h1>{p.name}</h1>
	<p class="sub">
		{#if data.isMe}That’s you.{:else if data.account}Account: {data.account}{:else}No account linked.{/if}
		{#if p.archived}<span class="tag">archived</span>{/if}
	</p>

	{#if page.data.can.manage}
		{#if renaming}
			<form class="rename" method="POST" action="?/rename" use:enhance={() => async ({ update, result }) => {
				await update({ reset: false });
				if (result.type === 'success') renaming = false;
			}}>
				<label class="field">
					<span>First name</span>
					<input name="first_name" value={p.firstName} maxlength="60" required />
				</label>
				<label class="field">
					<span>Last name</span>
					<input name="last_name" value={p.lastName ?? ''} maxlength="60" />
				</label>
				<div class="buttons">
					<button class="primary">Save</button>
					<button class="secondary" type="button" onclick={() => (renaming = false)}>Cancel</button>
				</div>
			</form>
		{:else}
			<div class="buttons">
				<button class="secondary" type="button" onclick={() => (renaming = true)}>Rename</button>
				{#if p.archived}
					<form method="POST" action="?/restore" use:enhance><button class="secondary">Restore</button></form>
				{:else}
					<form method="POST" action="?/remove" use:enhance>
						<button class="secondary danger-text" title={data.games.length ? 'Kept in the history, hidden from pickers' : 'Never played: removed for good'}>
							{data.games.length ? 'Archive' : 'Delete'}
						</button>
					</form>
				{/if}
			</div>
		{/if}
		{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
	{/if}
</section>

<h2>Games</h2>
{#if data.games.length === 0}
	<p class="empty card">No games yet.</p>
{:else}
	<ul class="list card">
		{#each data.games as game (game.id)}
			<li><GameRow {game} playerId={p.id} /></li>
		{/each}
	</ul>
{/if}

{#if data.next || data.paged}
	<nav class="pager" aria-label="Pages">
		{#if data.paged}<a href="?">Newest</a>{:else}<span></span>{/if}
		{#if data.next}<a href="?cursor={encodeURIComponent(data.next)}">Older games</a>{/if}
	</nav>
{/if}

<style>
	.back {
		display: inline-block;
		margin-bottom: 12px;
		color: var(--accent);
		text-decoration: none;
	}
	.profile {
		padding: 20px;
	}
	h1 {
		margin: 0 0 4px;
		font-size: 28px;
		letter-spacing: -0.02em;
	}
	.sub {
		margin: 0;
	}
	.tag {
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 6px;
		background: var(--fill);
		font-size: 12px;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}
	.buttons > *,
	.buttons form button {
		width: auto;
	}
	.buttons form {
		margin: 0;
	}
	.rename {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-top: 16px;
	}
	.rename .buttons {
		grid-column: 1 / -1;
		margin-top: 0;
	}
	.danger-text {
		color: var(--bad);
	}
	h2 {
		margin: 24px 4px 10px;
		font-size: 20px;
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
