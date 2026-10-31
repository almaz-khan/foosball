<script lang="ts">
	import '../app.css';

	let { data, children } = $props();
</script>

<svelte:head>
	<title>Foosball</title>
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
	.bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		max-width: 960px;
		margin: 0 auto;
		padding: 12px 16px;
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
	.page {
		max-width: 960px;
		margin: 0 auto;
		padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
	}
</style>
