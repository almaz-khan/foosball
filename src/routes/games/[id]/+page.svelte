<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let editing = $state(false);
	let confirmDelete = $state(false);
	let busy = $state(false);

	const g = $derived(data.game);
	const seats = [
		['red', 'offense'],
		['red', 'defense'],
		['blue', 'offense'],
		['blue', 'defense']
	] as const;

	const submit = () => {
		busy = true;
		return async ({ update, result }: { update: () => Promise<void>; result: { type: string } }) => {
			await update();
			busy = false;
			if (result.type === 'success') editing = false;
		};
	};
</script>

<svelte:head><title>Game · {g.red.score}:{g.blue.score}</title></svelte:head>

<a class="back" href="/games">← Games</a>

{#if page.url.searchParams.has('saved')}
	<p class="saved card" role="status">Game saved. <a href="/play">Play again</a></p>
{/if}

<section class="card board">
	<p class="when">
		{g.when}{#if g.duration}{` · ${g.duration}`}{/if}
	</p>
	<div class="teams">
		{#each ['red', 'blue'] as const as team (team)}
			<div class="team {team}" class:won={g.winner === team}>
				<span class="label">{team}{g.winner === team ? ' · won' : ''}</span>
				<span class="score">{g[team].score}</span>
				<a href="/players/{g[team].offense.id}"><small>Offense</small>{g[team].offense.name}</a>
				<a href="/players/{g[team].defense.id}"><small>Defense</small>{g[team].defense.name}</a>
			</div>
		{/each}
	</div>
	<p class="meta">
		{g.recordedBy ? `Recorded by ${g.recordedBy}` : 'Recorder unknown'}{#if g.source !== 'web'}{' · source '}<code>{g.source}</code>{/if}
	</p>

	{#if data.canEdit && !editing}
		<div class="actions">
			<button class="secondary" type="button" onclick={() => (editing = true)}>Edit</button>
			{#if confirmDelete}
				<form method="POST" action="?/delete" use:enhance>
					<button class="danger">Delete for good</button>
				</form>
				<button class="secondary" type="button" onclick={() => (confirmDelete = false)}>Keep it</button>
			{:else}
				<button class="secondary danger-text" type="button" onclick={() => (confirmDelete = true)}>Delete</button>
			{/if}
		</div>
	{/if}
	{#if form?.saved && !editing}<p class="ok" role="status">Saved.</p>{/if}
</section>

{#if editing}
	<form class="card edit stack" method="POST" action="?/save" use:enhance={submit}>
		<h2>Edit game</h2>
		<div class="grid">
			{#each seats as [team, position] (`${team}_${position}`)}
				<label class="field {team}">
					<span>{team} {position}</span>
					<select name="{team}_{position}" value={g[team][position].id} required>
						{#each data.players as p (p.id)}
							<option value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>
						{/each}
					</select>
				</label>
			{/each}
			<label class="field red">
				<span>red score</span>
				<input name="red_score" type="number" inputmode="numeric" min="0" max="99" value={g.red.score} required />
			</label>
			<label class="field blue">
				<span>blue score</span>
				<input name="blue_score" type="number" inputmode="numeric" min="0" max="99" value={g.blue.score} required />
			</label>
			<label class="field">
				<span>Started</span>
				<input name="started_at" type="datetime-local" value={data.times.startedAt} />
			</label>
			<label class="field">
				<span>Ended</span>
				<input name="ended_at" type="datetime-local" value={data.times.endedAt} />
			</label>
		</div>
		<p class="hint">Times are in {data.zone}.</p>
		{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
		<div class="actions">
			<button class="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
			<button class="secondary" type="button" onclick={() => (editing = false)}>Cancel</button>
		</div>
	</form>
{/if}

<style>
	.saved {
		margin: 0 0 12px;
		padding: 12px 16px;
		color: var(--accent);
		font-weight: 600;
	}
	.saved a {
		margin-left: 8px;
		color: inherit;
	}
	.back {
		display: inline-block;
		margin-bottom: 12px;
		color: var(--accent);
		text-decoration: none;
	}
	.board {
		padding: 20px;
	}
	.when,
	.meta {
		margin: 0;
		color: var(--text-2);
		font-size: 14px;
	}
	.meta {
		margin-top: 14px;
	}
	.teams {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-top: 14px;
	}
	.team {
		display: grid;
		gap: 6px;
		padding: 14px;
		border-radius: 12px;
		background: color-mix(in srgb, currentColor 10%, transparent);
	}
	.team.red {
		color: var(--red);
	}
	.team.blue {
		color: var(--blue);
		text-align: right;
	}
	.label {
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.score {
		font-size: 56px;
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--text-2);
	}
	.team.won .score {
		color: var(--text);
	}
	.team a {
		display: grid;
		color: var(--text);
		text-decoration: none;
		font-size: 16px;
		font-weight: 500;
	}
	.team small {
		font-size: 11px;
		color: var(--text-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}
	.actions > *,
	.actions form button {
		width: auto;
	}
	.actions form {
		margin: 0;
	}
	.danger {
		display: block;
		padding: 12px 20px;
		border: 0;
		border-radius: 12px;
		background: var(--bad);
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.danger-text {
		color: var(--bad);
	}
	.ok {
		margin: 12px 0 0;
		color: var(--accent);
		font-size: 14px;
	}
	.edit {
		margin-top: 16px;
		padding: 20px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.field.red span {
		color: var(--red);
	}
	.field.blue span {
		color: var(--blue);
	}
	.field span {
		text-transform: capitalize;
	}
	.hint {
		margin: 0;
	}
</style>
