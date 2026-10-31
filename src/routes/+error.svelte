<script lang="ts">
	import { page } from '$app/state';

	const title = $derived(
		page.status === 404 ? 'Not found' : page.status === 403 ? 'Not allowed' : 'Something went wrong'
	);
</script>

<svelte:head><title>{title} · Foosball</title></svelte:head>

<section class="card panel">
	<h1>{title}</h1>
	<p class="sub">{page.error?.message ?? 'Try again in a moment.'}</p>
	<a class="secondary" href="/">Back to the dashboard</a>
</section>
