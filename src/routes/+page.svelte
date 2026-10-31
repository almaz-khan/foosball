<script lang="ts">
	let { data } = $props();
</script>

{#if !data.member}
	<section class="card panel">
		<h1>No org yet</h1>
		<p class="sub">You’re signed in, but not a member of any org.</p>
		<p class="hint">Ask an org’s admin to send you an invite link.</p>
	</section>
{:else}
	<section class="card intro">
		<h1>{data.member.orgName}</h1>
		{#if data.member.playerName}
			<p>You play as <strong>{data.member.playerName}</strong>.</p>
		{:else}
			<p>You can follow the games. To record them, ask an admin to link you to a player.</p>
		{/if}
		<p class="soon">Games, players and the dashboard arrive in the next phases.</p>
	</section>
{/if}

<style>
	.intro {
		padding: 28px 24px;
	}
	h1 {
		margin: 0 0 8px;
		font-size: 28px;
		letter-spacing: -0.02em;
	}
	p {
		margin: 0 0 6px;
	}
	.soon {
		color: var(--text-2);
	}
</style>
