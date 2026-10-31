<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import {
		addPoint,
		backToSetup,
		formFields,
		isSeated,
		newPlay,
		restore,
		seat,
		SEATS,
		start,
		swapPositions,
		swapSides,
		tapSeat,
		type Play,
		type SeatName
	} from '#lib/play.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const newKey = () => crypto.randomUUID();

	// The server render shows an empty table; the browser then restores any game in progress.
	let play = $state<Play>(newPlay('pending'));
	let restored = $state(false);

	onMount(() => {
		let stored: string | null = null;
		try {
			stored = localStorage.getItem(data.storageKey);
		} catch {
			// Private mode or blocked storage: the game just won't survive a reload.
		}
		play = restore(stored) ?? newPlay(newKey());
		restored = true;
	});

	$effect(() => {
		if (!restored) return;
		const snapshot = JSON.stringify(play);
		try {
			localStorage.setItem(data.storageKey, snapshot);
		} catch {
			// As above.
		}
	});

	const names = $derived(new Map(data.players.map((p) => [p.id, p.name])));
	const nameOf = (id: number | null) => (id === null ? null : (names.get(id) ?? 'Removed player'));
	const seatedIds = $derived(new Set(SEATS.map((s) => play.seats[s]).filter((id) => id !== null)));
	// Me first, then the roster as listed.
	const pool = $derived(
		[...data.players].sort((a, b) => Number(b.id === data.me) - Number(a.id === data.me))
	);

	// ---------------------------------------------------------------- live clock

	let now = $state(Date.now());
	$effect(() => {
		if (play.phase !== 'live' || !play.startedAt) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const elapsed = $derived.by(() => {
		if (!play.startedAt) return null;
		const s = Math.max(0, Math.floor((now - Date.parse(play.startedAt)) / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	// Keep the phone awake next to the table while a game is on.
	$effect(() => {
		if (play.phase !== 'live' || !('wakeLock' in navigator)) return;
		let lock: WakeLockSentinel | null = null;
		let released = false;
		navigator.wakeLock
			.request('screen')
			.then((l) => {
				if (released) l.release().catch(() => {});
				else lock = l;
			})
			.catch(() => {});
		return () => {
			released = true;
			lock?.release().catch(() => {});
		};
	});

	// ---------------------------------------------------------------- guests

	let addingGuest = $state(false);
	let guestBusy = $state(false);

	// ---------------------------------------------------------------- finishing

	let confirming = $state(false);
	let discarding = $state(false);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	const leader = $derived(
		play.score.red > play.score.blue ? 'red' : play.score.blue > play.score.red ? 'blue' : null
	);
	const seatLabel = (s: SeatName) => s.split('.')[1];
</script>

<svelte:head><title>Play · {data.member?.orgName ?? 'Foosball'}</title></svelte:head>

{#if play.phase === 'setup'}
	<section class="setup">
		<div class="table">
			{#each ['red', 'blue'] as const as team (team)}
				<div class="team {team}">
					<div class="team-head">
						<h2>{team}</h2>
						<button class="icon" type="button" title="Swap offense and defense" aria-label="Swap {team} offense and defense" onclick={() => (play = swapPositions(play, team))}>⇅</button>
					</div>
					{#each SEATS.filter((s) => s.startsWith(team)) as s (s)}
						<button
							type="button"
							class="seat"
							class:selected={play.selected === s}
							class:empty={play.seats[s] === null}
							aria-pressed={play.selected === s}
							onclick={() => (play = tapSeat(play, s))}
						>
							<small>{seatLabel(s)}</small>
							<span>{nameOf(play.seats[s]) ?? (play.selected === s ? 'Choose below' : 'Empty')}</span>
						</button>
					{/each}
				</div>
			{/each}
		</div>
		<button class="swap" type="button" onclick={() => (play = swapSides(play))}>⇄ Swap sides</button>

		<h3>{play.selected ? `Who plays ${play.selected.replace('.', ' ')}?` : 'Tap players to seat them'}</h3>
		<div class="pool">
			{#each pool as p (p.id)}
				<button
					type="button"
					class="chip"
					class:seated={seatedIds.has(p.id)}
					onclick={() => (play = seat(play, p.id))}
				>
					{p.name}{p.id === data.me ? ' (you)' : ''}
				</button>
			{/each}
			{#if !addingGuest}
				<button type="button" class="chip add" onclick={() => (addingGuest = true)}>+ Guest</button>
			{/if}
		</div>

		{#if addingGuest}
			<form
				class="guest card"
				method="POST"
				action="?/addPlayer"
				use:enhance={() => {
					guestBusy = true;
					return async ({ result, update }) => {
						if (result.type === 'success' && result.data?.added) {
							const added = result.data.added as { id: number };
							await update();
							play = seat(play, added.id);
							addingGuest = false;
						} else {
							await update({ reset: false });
						}
						guestBusy = false;
					};
				}}
			>
				<label class="field">
					<span>First name</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input name="first_name" maxlength="60" required autofocus autocomplete="off" />
				</label>
				<label class="field">
					<span>Last name</span>
					<input name="last_name" maxlength="60" autocomplete="off" />
				</label>
				<div class="row">
					<button class="primary" disabled={guestBusy}>Add and seat</button>
					<button class="secondary" type="button" onclick={() => (addingGuest = false)}>Cancel</button>
				</div>
				{#if form?.addError}<p class="error" role="alert">{form.addError}</p>{/if}
			</form>
		{/if}

		<div class="go">
			<button class="primary big" type="button" disabled={!isSeated(play)} onclick={() => (play = start(play, true))}>
				Start game
			</button>
			<button class="secondary" type="button" disabled={!isSeated(play)} onclick={() => (play = start(play, false))}>
				Enter a final score
			</button>
		</div>
	</section>
{:else}
	<section class="live">
		<div class="live-head">
			<span class="clock" aria-label="Time played">{elapsed ?? 'Final score'}</span>
			{#if discarding}
				<span class="row">
					<button class="link danger-text" type="button" onclick={() => { play = backToSetup(play); discarding = false; }}>Discard game</button>
					<button class="link" type="button" onclick={() => (discarding = false)}>Keep</button>
				</span>
			{:else}
				<button class="link" type="button" onclick={() => (discarding = true)}>Discard</button>
			{/if}
		</div>

		<div class="board">
			{#each ['red', 'blue'] as const as team (team)}
				<div class="side {team}" class:leading={leader === team}>
					<button class="plus" type="button" aria-label="Goal for {team}" onclick={() => (play = addPoint(play, team, 1))}>
						<span class="label">{team}</span>
						<span class="score">{play.score[team]}</span>
						<span class="who">
							<span>{nameOf(play.seats[`${team}.offense`])}</span>
							<span>{nameOf(play.seats[`${team}.defense`])}</span>
						</span>
					</button>
					<button class="minus" type="button" aria-label="Take a goal back from {team}" disabled={play.score[team] === 0} onclick={() => (play = addPoint(play, team, -1))}>−1</button>
				</div>
			{/each}
		</div>

		{#if confirming}
			<form
				class="confirm card"
				method="POST"
				action="?/save"
				use:enhance={({ formData }) => {
					for (const [k, v] of Object.entries(formFields(play))) formData.set(k, v);
					saving = true;
					saveError = null;
					return async ({ result, update }) => {
						if (result.type === 'redirect') {
							// Saved: the same four stay seated for a rematch, under a new key.
							play = { ...backToSetup(play), clientKey: newKey() };
							confirming = false;
						} else if (result.type === 'error') {
							saveError = 'Could not reach the server. Your game is kept here: try again.';
						}
						await update();
						saving = false;
					};
				}}
			>
				<p>
					Save <strong class="red">red {play.score.red}</strong> : <strong class="blue">{play.score.blue} blue</strong>{leader ? '' : ' (a draw)'}?
				</p>
				<div class="row">
					<button class="primary" disabled={saving}>{saving ? 'Saving…' : 'Save game'}</button>
					<button class="secondary" type="button" onclick={() => (confirming = false)}>Keep playing</button>
				</div>
				{#if saveError ?? form?.saveError}<p class="error" role="alert">{saveError ?? form?.saveError}</p>{/if}
			</form>
		{:else}
			<button class="primary big" type="button" onclick={() => (confirming = true)}>Finish game</button>
		{/if}
	</section>
{/if}

<style>
	.setup,
	.live {
		display: grid;
		gap: 14px;
	}
	.table {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.team {
		display: grid;
		gap: 8px;
		padding: 12px;
		border-radius: var(--radius);
		background: color-mix(in srgb, currentColor 9%, var(--surface));
	}
	.team.red {
		color: var(--red);
	}
	.team.blue {
		color: var(--blue);
	}
	.team-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.icon {
		border: 0;
		background: none;
		color: inherit;
		font-size: 18px;
		cursor: pointer;
	}
	.seat {
		display: grid;
		gap: 2px;
		min-height: 58px;
		padding: 8px 10px;
		border: 2px solid transparent;
		border-radius: 12px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: 16px;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.seat small {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.seat.empty span {
		color: var(--text-2);
		font-weight: 400;
	}
	.seat.selected {
		border-color: currentColor;
	}
	.team.red .seat.selected {
		border-color: var(--red);
	}
	.team.blue .seat.selected {
		border-color: var(--blue);
	}
	.swap {
		justify-self: center;
		padding: 6px 14px;
		border: 0;
		border-radius: 999px;
		background: var(--fill);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
	}
	h3 {
		margin: 6px 0 0;
		font-size: 15px;
		color: var(--text-2);
		font-weight: 600;
	}
	.pool {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chip {
		padding: 10px 14px;
		border: 0;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: 0 0 0 1px var(--line);
		color: var(--text);
		font: inherit;
		font-size: 15px;
		cursor: pointer;
	}
	.chip.seated {
		opacity: 0.35;
	}
	.chip.add {
		background: var(--fill);
		box-shadow: none;
		color: var(--accent);
		font-weight: 600;
	}
	.guest {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding: 14px;
	}
	.guest .row,
	.guest .error {
		grid-column: 1 / -1;
		margin: 0;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.row > * {
		width: auto;
	}
	.go {
		display: grid;
		gap: 8px;
		margin-top: 6px;
	}
	.big {
		padding: 16px;
		font-size: 18px;
	}

	.live-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.clock {
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.danger-text {
		color: var(--bad);
	}
	.board {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.side {
		display: grid;
		gap: 8px;
	}
	.side.red {
		--team: var(--red);
	}
	.side.blue {
		--team: var(--blue);
	}
	.plus {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 6px;
		min-height: min(52vh, 420px);
		padding: 16px 8px;
		border: 0;
		border-radius: 20px;
		background: color-mix(in srgb, var(--team) 14%, var(--surface));
		color: var(--text);
		font: inherit;
		cursor: pointer;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		transition: transform 80ms ease;
	}
	.plus:active {
		transform: scale(0.98);
	}
	.leading .plus {
		background: color-mix(in srgb, var(--team) 26%, var(--surface));
	}
	.label {
		color: var(--team);
		font-size: 13px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.score {
		font-size: clamp(72px, 24vw, 140px);
		font-weight: 800;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.who {
		display: grid;
		justify-items: center;
		font-size: 15px;
		font-weight: 500;
		text-align: center;
	}
	.minus {
		padding: 12px;
		border: 0;
		border-radius: 12px;
		background: var(--fill);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		touch-action: manipulation;
	}
	.minus:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.confirm {
		display: grid;
		gap: 12px;
		padding: 16px;
	}
	.confirm p {
		margin: 0;
		font-size: 17px;
	}
	.confirm .error {
		margin: 0;
	}
	strong.red {
		color: var(--red);
	}
	strong.blue {
		color: var(--blue);
	}
</style>
