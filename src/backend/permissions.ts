/**
 * What the extension needs from the host, and whether it has it.
 *
 * Spindle gates parts of its API behind declared permissions. A call to a
 * permission we did not declare fails at the call site with `PERMISSION_DENIED`
 * — which is fine when the caller reports it, and invisible when it does not.
 *
 * That is not hypothetical. The tracker pass read chat messages through
 * `spindle.chat.getMessages`, which lives in a namespace gated by
 * `chat_mutation` even for reads. The permission was not declared, every pass
 * failed, and for a while the only symptom was that tracker state never moved.
 *
 * So the required set is written down here with a reason for each, checked at
 * startup, and logged. A missing permission should name itself before a feature
 * silently stops working, not after.
 */

/** The slice of `spindle.permissions` this module needs. */
export interface PermissionsApi {
    /** Synchronous — reads a local cache the host keeps in sync. */
    has(permission: string): boolean
    /** Fires whenever a gated call is blocked. */
    onDenied?(handler: (detail: { permission?: string; operation?: string }) => void): () => void
}

export interface LogApi {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
}

export interface RequiredPermission {
    name: string
    /** What stops working without it, in words a user would recognise. */
    needs: string
}

/**
 * Every permission the extension declares, and what it buys.
 *
 * Keep this in step with `spindle.json`. The audit below compares the two, so a
 * permission added to one and not the other is reported rather than discovered
 * by a feature failing.
 */
export const REQUIRED_PERMISSIONS: RequiredPermission[] = [
    { name: 'generation', needs: 'running the tracker pass, and hearing when a reply finishes' },
    { name: 'interceptor', needs: 'putting tracker state into the next prompt' },
    {
        name: 'tools',
        // Only in "Pre-seeded + tool calls" mode. Without it the tool cannot
        // be registered, the narrator is still told to call it, and it will
        // fall back to simulating a die: the audit names this at startup.
        needs: 'giving the narrator a dice tool to call by name',
    },
    {
        name: 'chat_mutation',
        // The name says mutation; the namespace it gates is where getMessages
        // lives, and reading recent narrative is all we do with it.
        needs: 'reading the recent narrative the tracker pass summarises, and sending a CYOA choice as your message',
    },
    { name: 'world_books', needs: 'the campaign\'s lorebooks: reading and writing them, and reading which are active (55)' },
    {
        name: 'images',
        // Only the upload half. A portrait pasted as a URL needs nothing, so a
        // missing grant costs the file picker rather than the feature.
        needs: 'storing a portrait you pick from your computer',
    },
    {
        name: 'regex_scripts',
        // The display script that hides the <choices> block (31a, back behind
        // a preference since 65, on by default): installed by name in the
        // host's regex library on the first request of a session, and removed
        // by name when the preference is switched off. Without the grant the
        // block is hidden by the panel's own sweep alone, which can leave it
        // showing until the next refresh.
        needs: 'installing the regex script that hides the choices block in replies, and removing it when switched off',
    },
    {
        name: 'characters',
        // Import Card (39): the list of the host's cards to pick from, the
        // card picked, and the narrator's card as the import's world reference.
        needs: 'listing your character cards, importing one as the player, and attaching the campaign\'s lorebooks to the narrator\'s card (55)',
    },
    {
        name: 'personas',
        // The character creator's last step (35b): a persona with the
        // character's name, so the player's messages carry it. Without the
        // grant the sheet and the Player Card are still written, and the
        // persona step says so in the fold.
        needs: 'making a persona with the character\'s name when a character is created',
    },
    {
        name: 'chats',
        // Self-named campaigns (51-bis): which card a chat belongs to, read
        // from the chat's own record, since the panel's view of the active
        // chat has no card for a chat just made. Without the grant a new
        // chat is named after the panel's id when it has one, and not at
        // all until it does.
        needs: 'reading which card a chat belongs to, to name its campaign after it',
    },
    {
        name: 'image_gen',
        // The scene picture (49): the legacy's Real-Time Mode through the
        // host's own image generation. Without the grant the fold's Draw
        // button and the mode fail with the grant named; a picture set by
        // hand still works, as it needs only `images`.
        needs: 'drawing the scene\'s picture through Lumiverse\'s image generation',
    },
    {
        name: 'ui_panels',
        // The two floating widgets (47c): the tracker, and the map, scene and
        // relationships. Both example extensions declare it for theirs. Without
        // the grant the widgets layout falls back to the two tabs, and the
        // version line names the grant.
        needs: 'drawing the floating widgets of the widgets layout',
    },
]

export interface PermissionAudit {
    granted: string[]
    missing: RequiredPermission[]
    /**
     * False when the host exposed no permissions API, so the two lists above
     * say nothing. Without this, "nothing is granted" and "we cannot tell" are
     * both a pair of empty lists — and the panel has to word them differently.
     */
    checked: boolean
}

/**
 * Check what has been granted, without saying anything about it.
 *
 * Split out from `auditPermissions` so the panel can ask this on demand rather
 * than being served the startup snapshot. Permissions can be granted while the
 * extension is running — that is the whole point of `onChanged` — so a cached
 * answer would tell a user who has just fixed the problem that it is still
 * broken.
 *
 * Never throws: a host without a `permissions` API degrades to "unknown".
 */
export function checkPermissions(permissions: PermissionsApi | undefined): PermissionAudit {
    if (!permissions || typeof permissions.has !== 'function') {
        return { granted: [], missing: [], checked: false }
    }

    const granted: string[] = []
    const missing: RequiredPermission[] = []

    for (const permission of REQUIRED_PERMISSIONS) {
        let held = false
        try {
            held = permissions.has(permission.name)
        } catch {
            held = false
        }
        if (held) granted.push(permission.name)
        else missing.push(permission)
    }

    return { granted, missing, checked: true }
}

/**
 * Check what has been granted and say so.
 *
 * Never throws: a host that does not expose `permissions` should degrade to
 * "unknown", not take the backend down on startup.
 */
export function auditPermissions(permissions: PermissionsApi | undefined, log: LogApi): PermissionAudit {
    const audit = checkPermissions(permissions)
    const { granted, missing } = audit

    if (!audit.checked) {
        log.warn('permissions API unavailable; cannot check what has been granted')
        return audit
    }

    if (missing.length === 0) {
        log.info(`permissions granted: ${granted.join(', ')}`)
    } else {
        for (const permission of missing) {
            log.warn(`permission "${permission.name}" not granted — ${permission.needs} will not work`)
        }
        log.warn(
            `${missing.length} permission(s) missing. Update the extension in Lumiverse so it re-reads ` +
                'spindle.json, then grant them in the extension panel.',
        )
    }

    return audit
}

/**
 * Log any gated call the host blocks.
 *
 * The backstop for a permission this module does not know it needs — the exact
 * situation `chat_mutation` was in. Returns a disposer, or null if the host
 * does not offer the hook.
 */
export function reportDeniedPermissions(permissions: PermissionsApi | undefined, log: LogApi): (() => void) | null {
    if (!permissions || typeof permissions.onDenied !== 'function') return null
    try {
        return permissions.onDenied((detail) => {
            log.error(
                `blocked by a missing permission: ${detail.permission ?? 'unknown'}` +
                    `${detail.operation ? ` (calling ${detail.operation})` : ''}`,
            )
        })
    } catch {
        return null
    }
}
