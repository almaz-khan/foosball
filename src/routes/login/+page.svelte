<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const errors = {
		denied: 'This account doesn’t have access to Foosball. Ask whoever runs it.',
		method: 'Foosball needs a sign-in with a passkey.',
		failed: 'Signing in didn’t work. Try again.',
		expired: 'That sign-in took too long or was already used. Try again.',
		unavailable: 'The sign-in service can’t be reached right now. Try again in a minute.'
	};
</script>

<svelte:head><title>Sign in · Foosball</title></svelte:head>

<section class="card panel">
	<h1>Foosball</h1>

	{#if data.error}
		<p class="error" role="alert">{errors[data.error]}</p>
	{:else}
		<p class="sub">You’re signed out.</p>
	{/if}
	<a class="primary" href={data.signInHref} data-sveltekit-reload>Sign in</a>
	<p class="hint after">Foosball signs you in with your passkey at {data.hubHost}.</p>
</section>

<style>
	.after {
		margin: 16px 0 0;
	}
</style>
