<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import CopyLink from '#lib/components/CopyLink.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let inviting = $state(false);
	let playerMode = $state<'new' | 'existing' | 'none'>('new');
	let inviteName = $state('');
	let removing = $state<number | null>(null);

	const unlinked = $derived(data.players.filter((p) => p.linkedTo === null));
	/** Choices for one member's player: anyone unlinked, plus whoever they are now. */
	const choicesFor = (playerId: number | null) => data.players.filter((p) => p.linkedTo === null || p.id === playerId);
	const submitOnChange = (e: Event) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
</script>

<svelte:head><title>Admin · {page.data.member?.orgName ?? 'Foosball'}</title></svelte:head>

<h1>Admin</h1>

{#if form?.message}<p class="error banner card" role="alert">{form.message}</p>{/if}

<section class="card block">
	<div class="section-head">
		<h2>Invites</h2>
		{#if !inviting}
			<button class="primary compact" type="button" onclick={() => (inviting = true)}>Invite someone</button>
		{/if}
	</div>

	{#if form?.invite}
		<div class="made">
			<p><strong>Invite for {form.invite.name}</strong>. Send them this link. It works once, until {form.invite.expires}.</p>
			<CopyLink url={form.invite.link} />
		</div>
	{/if}

	{#if inviting}
		<form class="invite stack" method="POST" action="?/invite" use:enhance={() => async ({ update, result }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				inviting = false;
				inviteName = '';
			}
		}}>
			<div class="two">
				<label class="field">
					<span>Their name</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input name="name" bind:value={inviteName} maxlength="40" required autofocus autocomplete="off" />
				</label>
				<label class="field">
					<span>Role</span>
					<select name="role">
						<option value="member">Member</option>
						<option value="admin">Admin: manages members and the roster</option>
					</select>
				</label>
			</div>

			<fieldset>
				<legend>At the table they are…</legend>
				<label class="choice"><input type="radio" name="player_mode" value="new" bind:group={playerMode} /> A new player</label>
				<label class="choice" class:off={unlinked.length === 0}>
					<input type="radio" name="player_mode" value="existing" bind:group={playerMode} disabled={unlinked.length === 0} />
					A player already on the roster
				</label>
				<label class="choice"><input type="radio" name="player_mode" value="none" bind:group={playerMode} /> Nobody: they only watch</label>
			</fieldset>

			{#if playerMode === 'new'}
				<div class="two">
					<label class="field">
						<span>First name</span>
						<input name="first_name" value={inviteName.split(' ')[0] ?? ''} maxlength="60" required />
					</label>
					<label class="field">
						<span>Last name</span>
						<input name="last_name" value={inviteName.split(' ').slice(1).join(' ')} maxlength="60" />
					</label>
				</div>
			{:else if playerMode === 'existing'}
				<label class="field">
					<span>Player</span>
					<select name="player_id" required>
						{#each unlinked as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</label>
			{/if}

			<p class="hint">The link works once, for {data.inviteHours} hours. Opening it, they sign in at the login hub and join: the hub must already let them open Foosball.</p>
			<div class="row">
				<button class="primary">Create invite link</button>
				<button class="secondary" type="button" onclick={() => (inviting = false)}>Cancel</button>
			</div>
		</form>
	{/if}

	{#if data.invites.length}
		<ul class="rows">
			{#each data.invites as i (i.id)}
				<li>
					<div class="who">
						<strong>{i.invitedName}{#if i.role === 'admin'}<span class="tag">admin</span>{/if}</strong>
						<small>{i.playerName ? `as ${i.playerName}` : 'watches only'} · until {i.expires}</small>
					</div>
					<form method="POST" action="?/revokeInvite" use:enhance>
						<input type="hidden" name="id" value={i.id} />
						<button class="link danger-text">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else if !inviting && !form?.invite}
		<p class="hint">No pending invites.</p>
	{/if}
</section>

<section class="card block">
	<h2>Members</h2>
	<ul class="rows members">
		{#each data.members as m (m.userId)}
			<li>
				<div class="who">
					<strong>{m.userName}{#if m.userId === data.me}<span class="tag">you</span>{/if}</strong>
					<small>{m.playerName ? `plays as ${m.playerName}` : 'watches: no player'}</small>
				</div>
				<div class="controls">
					<form method="POST" action="?/setRole" use:enhance={() => async ({ update }) => update({ reset: false })}>
						<input type="hidden" name="user_id" value={m.userId} />
						<label class="field">
							<span>Role</span>
							<select name="role" value={m.role} onchange={submitOnChange}>
								<option value="member">Member</option>
								<option value="admin">Admin</option>
							</select>
						</label>
					</form>
					<form method="POST" action="?/linkPlayer" use:enhance={() => async ({ update }) => update({ reset: false })}>
						<input type="hidden" name="user_id" value={m.userId} />
						<label class="field">
							<span>Player</span>
							<select name="player_id" value={m.playerId ?? ''} onchange={submitOnChange}>
								<option value="">— none (watches) —</option>
								{#each choicesFor(m.playerId) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
							</select>
						</label>
					</form>
				</div>
				<div class="actions">
					{#if removing === m.userId}
						<form method="POST" action="?/removeMember" use:enhance={() => async ({ update }) => {
							await update();
							removing = null;
						}}>
							<input type="hidden" name="user_id" value={m.userId} />
							<button class="link danger-text">{m.userId === data.me ? 'Leave the org' : `Remove ${m.userName}`}</button>
						</form>
						<button class="link" type="button" onclick={() => (removing = null)}>Keep</button>
					{:else}
						<button class="link danger-text" type="button" onclick={() => (removing = m.userId)}>{m.userId === data.me ? 'Leave' : 'Remove'}</button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	<p class="hint">
		Removing someone takes them out of this org only; their games stay. Their player stays on the roster, for the
		history.
	</p>
</section>

<style>
	h1 {
		margin: 0 0 14px;
		font-size: 28px;
		letter-spacing: -0.02em;
	}
	h2 {
		margin: 0;
		font-size: 18px;
	}
	.banner {
		margin: 0 0 14px;
		padding: 12px 16px;
	}
	.block {
		display: grid;
		gap: 14px;
		padding: 18px;
		margin-bottom: 14px;
	}
	.block > .hint {
		margin: 0;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.compact {
		width: auto;
		padding: 8px 14px;
		font-size: 15px;
	}
	.made {
		display: grid;
		gap: 10px;
		padding: 14px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--accent) 9%, transparent);
	}
	.made p {
		margin: 0;
	}
	.invite {
		padding: 14px;
		border-radius: 12px;
		background: var(--fill);
	}
	.invite .field input,
	.invite .field select {
		background: var(--surface);
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	@media (max-width: 520px) {
		.two {
			grid-template-columns: 1fr;
		}
	}
	fieldset {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		margin-bottom: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.choice.off {
		color: var(--text-2);
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.row button {
		width: auto;
	}
	.hint {
		margin: 0;
	}
	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rows li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		padding: 12px 0;
	}
	.rows li + li {
		border-top: 1px solid var(--line);
	}
	.rows form {
		margin: 0;
	}
	.who {
		display: grid;
		flex: 1;
		min-width: 160px;
	}
	.who small {
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
	.controls {
		display: flex;
		gap: 8px;
	}
	.controls .field select {
		padding: 6px 8px;
		font-size: 15px;
	}
	.actions {
		display: flex;
		gap: 14px;
		font-size: 14px;
	}
	.danger-text {
		color: var(--bad);
	}
</style>
