<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let adding = $state(false);
</script>

<svelte:head><title>Players · {page.data.member?.orgName ?? 'Foosball'}</title></svelte:head>

<div class="head">
	<h1>{data.archived ? 'Archived players' : 'Players'}</h1>
	{#if page.data.can.manage && !data.archived && !adding}
		<button class="secondary compact" type="button" onclick={() => (adding = true)}>Add player</button>
	{/if}
</div>

{#if adding}
	<form class="card add" method="POST" action="?/add" use:enhance>
		<label class="field">
			<span>First name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input name="first_name" maxlength="60" required autofocus autocomplete="off" />
		</label>
		<label class="field">
			<span>Last name</span>
			<input name="last_name" maxlength="60" autocomplete="off" />
		</label>
		<div class="buttons">
			<button class="primary">Add</button>
			<button class="secondary" type="button" onclick={() => (adding = false)}>Cancel</button>
		</div>
		{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
	</form>
{/if}

{#if data.players.length === 0}
	<p class="empty card">
		{data.archived ? 'Nobody is archived.' : 'No players yet.'}
	</p>
{:else}
	<ul class="list card">
		{#each data.players as p (p.id)}
			<li>
				<a href="/players/{p.id}">
					<span class="name">{p.name}</span>
					{#if p.account}<span class="account">{p.account}</span>{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<p class="switch">
	{#if data.archived}
		<a href="/players">Back to the roster</a>
	{:else if data.archivedCount > 0}
		<a href="/players?archived">Archived ({data.archivedCount})</a>
	{/if}
</p>

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
	.add {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		padding: 16px;
		margin-bottom: 14px;
	}
	.buttons {
		grid-column: 1 / -1;
		display: flex;
		gap: 8px;
	}
	.buttons > * {
		width: auto;
	}
	.add .error {
		grid-column: 1 / -1;
		margin: 0;
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
	.list a {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		color: var(--text);
		text-decoration: none;
	}
	.list a:hover {
		background: var(--fill);
	}
	.name {
		font-weight: 500;
	}
	.account {
		font-size: 13px;
		color: var(--text-2);
	}
	.empty {
		padding: 24px 16px;
		margin: 0;
		color: var(--text-2);
		text-align: center;
	}
	.switch {
		margin: 14px 4px;
	}
	.switch a {
		color: var(--accent);
		text-decoration: none;
		font-size: 15px;
	}
</style>
