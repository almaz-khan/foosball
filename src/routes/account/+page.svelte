<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let editingName = $state(false);
</script>

<svelte:head><title>Account · Foosball</title></svelte:head>

<h1>Account</h1>

<section class="card block">
	<h2>Name</h2>
	{#if editingName}
		<form class="inline" method="POST" action="?/rename" use:enhance={() => async ({ update, result }) => {
			await update({ reset: false });
			if (result.type === 'success') editingName = false;
		}}>
			<label class="field grow">
				<span class="sr-only">Your name</span>
				<input name="name" value={page.data.userName} maxlength="40" required autocomplete="name" />
			</label>
			<button class="primary">Save</button>
			<button class="secondary" type="button" onclick={() => (editingName = false)}>Cancel</button>
		</form>
		{#if form?.nameError}<p class="error" role="alert">{form.nameError}</p>{/if}
	{:else}
		<div class="inline">
			<span class="grow value">{page.data.userName}</span>
			<button class="secondary" type="button" onclick={() => (editingName = true)}>Change</button>
		</div>
	{/if}
</section>

<section class="card block">
	<h2>Passkeys</h2>
	<p class="hint">
		You sign in at <a href={data.hubUrl}>{data.hubHost}</a>, the sign-in shared by all of almaz.dev’s apps. Add or
		remove your passkeys there.
	</p>
</section>

{#if data.orgs.length > 0}
	<section class="card block">
		<h2>Orgs</h2>
		<ul class="rows">
			{#each data.orgs as o (o.slug)}
				<li>
					<div class="key">
						<strong>{o.name}{#if o.role === 'admin'}<span class="tag">admin</span>{/if}</strong>
						<small>{o.playerName ? `You play as ${o.playerName}` : 'You watch: not linked to a player'}</small>
					</div>
					{#if o.current}
						<span class="current">Current</span>
					{:else}
						<form method="POST" action="?/switchOrg">
							<input type="hidden" name="org" value={o.slug} />
							<button class="secondary">Open</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	h1 {
		margin: 0 0 14px;
		font-size: 28px;
		letter-spacing: -0.02em;
	}
	h2 {
		margin: 0 0 10px;
		font-size: 18px;
	}
	.block {
		display: grid;
		gap: 12px;
		padding: 18px;
		margin-bottom: 14px;
	}
	.block h2,
	.block .hint,
	.block .error {
		margin: 0;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.inline button,
	li button {
		width: auto;
		white-space: nowrap;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.value {
		font-size: 17px;
		font-weight: 500;
	}
	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rows li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
	}
	.rows li + li {
		border-top: 1px solid var(--line);
	}
	.rows li form {
		margin: 0;
	}
	.key {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.key small {
		color: var(--text-2);
	}
	.tag {
		margin-left: 8px;
		padding: 1px 6px;
		border-radius: 6px;
		background: var(--fill);
		font-size: 12px;
		font-weight: 500;
	}
	.current {
		font-size: 14px;
		color: var(--text-2);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
