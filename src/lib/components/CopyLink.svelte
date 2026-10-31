<script lang="ts">
	/** A link to hand to someone: shown in full, with Copy (and Share where the device has it). */
	let { url, note }: { url: string; note?: string } = $props();

	let copied = $state(false);
	let canShare = $state(false);

	$effect(() => {
		canShare = typeof navigator !== 'undefined' && 'share' in navigator;
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// No clipboard access: the field is selectable by hand.
		}
	}

	async function share() {
		try {
			await navigator.share({ url });
		} catch {
			// Cancelled.
		}
	}
</script>

<div class="link-box">
	<input readonly value={url} aria-label="Link" onfocus={(e) => e.currentTarget.select()} />
	<div class="buttons">
		<button class="primary" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
		{#if canShare}<button class="secondary" type="button" onclick={share}>Share…</button>{/if}
	</div>
	{#if note}<p class="hint">{note}</p>{/if}
</div>

<style>
	.link-box {
		display: grid;
		gap: 10px;
	}
	input {
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-radius: 10px;
		background: var(--fill);
		color: var(--text);
		font: 14px ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.buttons {
		display: flex;
		gap: 8px;
	}
	.buttons button {
		width: auto;
	}
	.hint {
		margin: 0;
	}
</style>
