<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { createPasskey, describe, guessDeviceName } from '#lib/passkeys.ts';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let busy = $state(false);
	let message = $state<string | null>(null);
	// Prefilled from the invite; the person may prefer another spelling.
	let userName = $state('');
	let deviceName = $state('');

	onMount(() => {
		userName = data.invite?.invitedName ?? '';
		deviceName = guessDeviceName();
	});

	const role = $derived(data.invite?.role === 'admin' ? 'an admin' : 'a member');

	async function onCreate(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		message = null;
		try {
			await createPasskey(deviceName, { invite: page.params.token!, userName });
			await invalidateAll();
			await goto('/', { replace: true });
		} catch (err) {
			message = describe(err);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Invitation · Foosball</title></svelte:head>

<section class="card panel">
	{#if !data.invite}
		<h1>Invitation</h1>
		<p class="sub">This invite was already used or has expired.</p>
		<p class="hint">Ask whoever sent it for a new one.</p>
		<a class="secondary" href="/login">Sign in</a>
	{:else}
		<h1>{data.invite.orgName}</h1>
		<p class="sub">
			You’re invited to join as {role}{#if data.invite.playerName}, playing as
				<strong>{data.invite.playerName}</strong>{/if}.
		</p>

		{#if data.wrongOrigin}
			<p class="hint">Passkeys only work at <strong>{data.wrongOrigin}</strong>.</p>
			<a class="primary" href={data.wrongOrigin + page.url.pathname}>Open the invite there</a>
		{:else if data.alreadyMember}
			<p class="hint">You’re already a member, signed in as <strong>{data.signedInAs}</strong>.</p>
			<a class="primary" href="/">Open {data.invite.orgName}</a>
		{:else if data.signedInAs}
			<form method="POST" action="?/join" use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}>
				<button class="primary" disabled={busy}>Join as {data.signedInAs}</button>
			</form>
			<p class="hint after">
				Not {data.signedInAs}?
				<button class="link" type="submit" form="sign-out">Sign out</button> and open this link again.
			</p>
			<form id="sign-out" method="POST" action="/auth/logout" hidden></form>
		{:else}
			<form class="stack" onsubmit={onCreate}>
				<label class="field">
					<span>Your name</span>
					<input bind:value={userName} maxlength="40" required autocomplete="name" />
				</label>
				<label class="field">
					<span>Device name</span>
					<input bind:value={deviceName} maxlength="60" required autocomplete="off" />
				</label>
				<button class="primary" type="submit" disabled={busy}>
					{busy ? 'Waiting for the passkey…' : 'Create passkey and join'}
				</button>
			</form>
			<p class="hint after">
				Already have an account? <a href="/login?next={encodeURIComponent(page.url.pathname)}">Sign in</a> to join with it.
			</p>
		{/if}

		{#if message || form?.message}<p class="error" role="alert">{message ?? form?.message}</p>{/if}
	{/if}
</section>

<style>
	.after {
		margin: 16px 0 0;
	}
</style>
