<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { createPasskey, describe, guessDeviceName, signIn } from '#lib/passkeys.ts';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let busy = $state(false);
	let message = $state<string | null>(null);
	let deviceName = $state('');

	onMount(() => {
		deviceName = guessDeviceName();
	});

	const mode = $derived(
		data.configError || data.wrongOrigin
			? 'blocked'
			: data.enroll
				? data.enrollName
					? 'enroll'
					: 'enroll-expired'
				: data.hasPasskeys
					? 'sign-in'
					: 'empty'
	);

	async function run(action: () => Promise<string>) {
		busy = true;
		message = null;
		try {
			const next = await action();
			await invalidateAll();
			await goto(next, { replace: true });
		} catch (err) {
			message = describe(err);
		} finally {
			busy = false;
		}
	}

	const onSignIn = () => run(() => signIn(data.next));
	const onEnroll = (event: SubmitEvent) => {
		event.preventDefault();
		run(async () => {
			await createPasskey(deviceName, { enroll: data.enroll! });
			return '/';
		});
	};

	const wrongOriginHref = $derived(
		data.wrongOrigin ? data.wrongOrigin + page.url.pathname + page.url.search : null
	);
</script>

<svelte:head><title>Sign in · Foosball</title></svelte:head>

<section class="card panel">
	<h1>Foosball</h1>

	{#if mode === 'blocked'}
		{#if data.configError}
			<p class="sub">The server’s address is misconfigured, so passkeys can’t work:</p>
			<p class="error">{data.configError}</p>
		{:else}
			<p class="sub">Passkeys only work at <strong>{data.wrongOrigin}</strong>.</p>
			<a class="primary" href={wrongOriginHref}>Go there</a>
		{/if}
	{:else if mode === 'enroll'}
		<p class="sub">Add a passkey for <strong>{data.enrollName}</strong> on this device.</p>
		<form class="stack" onsubmit={onEnroll}>
			<label class="field">
				<span>Device name</span>
				<input bind:value={deviceName} maxlength="60" required autocomplete="off" />
			</label>
			<button class="primary" type="submit" disabled={busy}>
				{busy ? 'Waiting for the passkey…' : 'Create passkey'}
			</button>
		</form>
	{:else if mode === 'enroll-expired'}
		<p class="sub">This link was already used or has expired.</p>
		<p class="hint">Ask an admin for a new one.</p>
		{#if data.hasPasskeys}<a class="secondary" href="/login">Sign in instead</a>{/if}
	{:else if mode === 'empty'}
		<p class="sub">Nobody has an account yet.</p>
		<p class="hint">
			Create an org and invite its first admin from the server:
			<code>foosball invite create --org &lt;slug&gt; --name &lt;name&gt; --admin</code>
		</p>
	{:else}
		<p class="sub">Sign in with your passkey.</p>
		<button class="primary" type="button" onclick={onSignIn} disabled={busy}>
			{busy ? 'Waiting for the passkey…' : 'Sign in'}
		</button>
		<p class="hint after">No account? Accounts are by invite: ask someone in your org.</p>
	{/if}

	{#if message}<p class="error" role="alert">{message}</p>{/if}
</section>

<style>
	.after {
		margin: 16px 0 0;
	}
</style>
