<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { data, children } = $props();

	const tabs = $derived([
		{ href: '/', label: 'Dashboard' },
		{ href: '/games', label: 'Games' },
		{ href: '/players', label: 'Players' },
		...(data.can.record ? [{ href: '/play', label: 'Play' }] : [])
	]);
	const current = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
</script>

<svelte:head>
	<title>{data.member?.orgName ?? 'Foosball'}</title>
</svelte:head>

{#if data.userName}
	<header class="bar">
		<div class="bar-inner">
			<a class="brand" href="/">{data.member?.orgName ?? 'Foosball'}</a>
			<div class="who">
				<span class="name">
					{data.userName}{#if data.member?.role === 'admin'}<span class="tag">admin</span>{/if}
				</span>
				<form method="POST" action="/auth/logout">
					<button class="link">Sign out</button>
				</form>
			</div>
		</div>
		{#if data.member}
			<nav class="tabs" aria-label="Sections">
				{#each tabs as tab (tab.href)}
					<a href={tab.href} aria-current={current(tab.href) ? 'page' : undefined} class:play={tab.href === '/play'}>
						{tab.label}
					</a>
				{/each}
			</nav>
		{/if}
	</header>
{/if}

<main class="page">
	{@render children()}
</main>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 10;
		background: color-mix(in srgb, var(--surface) 85%, transparent);
		backdrop-filter: saturate(180%) blur(16px);
		box-shadow: 0 1px 0 var(--line);
	}
	.bar-inner,
	.tabs {
		max-width: 960px;
		margin: 0 auto;
		padding: 0 16px;
	}
	.bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-top: 12px;
		padding-bottom: 8px;
	}
	.brand {
		font-weight: 700;
		font-size: 18px;
		letter-spacing: -0.01em;
		color: var(--text);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 14px;
		flex-shrink: 0;
	}
	.name {
		color: var(--text-2);
	}
	.tag {
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 6px;
		background: var(--fill);
		font-size: 12px;
	}
	form {
		margin: 0;
	}
	.tabs {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		padding-bottom: 8px;
		scrollbar-width: none;
	}
	.tabs a {
		padding: 6px 12px;
		border-radius: 999px;
		color: var(--text-2);
		font-size: 15px;
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}
	.tabs a[aria-current='page'] {
		background: var(--fill);
		color: var(--text);
	}
	.tabs a.play {
		margin-left: auto;
		background: var(--accent);
		color: #fff;
	}
	.page {
		max-width: 960px;
		margin: 0 auto;
		padding: 20px 16px calc(24px + env(safe-area-inset-bottom));
	}
</style>
