<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import CopyLink from '#lib/components/CopyLink.svelte';
	import { createPasskey, describe, guessDeviceName } from '#lib/passkeys.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let editingName = $state(false);
	let renaming = $state<string | null>(null);
	let removing = $state<string | null>(null);
	let adding = $state(false);
	let addError = $state<string | null>(null);

	async function addHere() {
		adding = true;
		addError = null;
		try {
			await createPasskey(guessDeviceName());
			await invalidateAll();
		} catch (err) {
			addError = describe(err);
		} finally {
			adding = false;
		}
	}
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
	<p class="hint">You sign in with any of these. Keep at least two, on different devices, so losing one phone doesn’t lock you out.</p>
	<ul class="rows">
		{#each data.passkeys as p (p.id)}
			<li>
				{#if renaming === p.id}
					<form class="inline" method="POST" action="?/renamePasskey" use:enhance={() => async ({ update }) => {
						await update({ reset: false });
						renaming = null;
					}}>
						<input type="hidden" name="id" value={p.id} />
						<label class="field grow">
							<span class="sr-only">Passkey name</span>
							<input name="name" value={p.name} maxlength="60" required />
						</label>
						<button class="primary">Save</button>
						<button class="secondary" type="button" onclick={() => (renaming = null)}>Cancel</button>
					</form>
				{:else}
					<div class="key">
						<strong>{p.name}{#if p.current}<span class="tag">this browser</span>{/if}</strong>
						<small>Added {p.added} · {p.lastUsed ? `last used ${p.lastUsed}` : 'never used to sign in'}</small>
					</div>
					{#if removing === p.id}
						<form method="POST" action="?/revokePasskey" use:enhance={() => async ({ update }) => {
							await update();
							removing = null;
						}}>
							<input type="hidden" name="id" value={p.id} />
							<button class="danger-text secondary">{p.current ? 'Remove and sign out' : 'Remove'}</button>
						</form>
						<button class="link" type="button" onclick={() => (removing = null)}>Keep</button>
					{:else}
						<button class="link" type="button" onclick={() => (renaming = p.id)}>Rename</button>
						<button class="link danger-text" type="button" onclick={() => (removing = p.id)}>Remove</button>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
	{#if form?.passkeyError}<p class="error" role="alert">{form.passkeyError}</p>{/if}

	<div class="add">
		<button class="secondary" type="button" disabled={adding} onclick={addHere}>
			{adding ? 'Waiting for the passkey…' : 'Add a passkey'}
		</button>
		<form method="POST" action="?/enrollLink" use:enhance>
			<button class="secondary">Link for another device</button>
		</form>
	</div>
	<p class="hint">
		“Add a passkey” uses this browser, or your phone through the QR code your browser offers. A link works on any device:
		open it there and create the passkey.
	</p>
	{#if addError}<p class="error" role="alert">{addError}</p>{/if}
	{#if form?.enrollLink}
		<CopyLink url={form.enrollLink} note="Works once, for the next {form.enrollMinutes} minutes. Anyone with it can add a passkey to your account: send it only to yourself." />
	{/if}
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
	.add button,
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
	.rows li form.inline {
		flex: 1;
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
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.add form {
		margin: 0;
	}
	.danger-text {
		color: var(--bad);
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
