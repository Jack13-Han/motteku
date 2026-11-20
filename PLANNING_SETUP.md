# Group Polls and Departure Readiness

## Enable the new data paths

Existing chat messages, replies and reactions keep their current data. These two new features add their own collections and require the updated **complete** `firestore.rules` file.

1. Open the Firebase project used by this app.
2. Choose **Cloud Firestore → Rules**.
3. Copy the complete contents of this repository's `firestore.rules` into the editor and select **Publish**.
4. Refresh the app in both members' browsers.

Do not replace the rules with a blanket `allow read, write: if true`. No Storage bucket, new paid service or API key is required for these features. Normal Firestore usage and quotas still apply.

## Group Polls / Voting

- Open **Group chat** after creating or joining a room, or open a managed trip's **Trip workspace**.
- Create a question and 2–5 different choices. Each member has one vote and may change it or click their selected choice again to remove it.
- Results update from Firestore. The creator, chat owner, or managed-trip organizer/admin can close a poll. A closed poll remains visible and cannot receive votes or reopen.
- Each panel shows the latest 20 polls. The chat room and managed trip have separate scopes; polls are not copied between them.
- In local demo mode, shared polls require Firebase sign-in rather than pretending to synchronize.

Data paths:

```text
sharedTrips/{roomId}/polls/{pollId}
trips/{tripId}/polls/{pollId}
```

## Departure Readiness Check

Open **Packing list** (or the confirmed managed trip's packing section), then the readiness panel. The organizer chooses essentials from the existing packing items. Members first mark their required packing assignments **Packed**, then confirm their own readiness. Required shared items must all be assigned to active members and packed.

Each active roster member must be linked to their own Firebase account. For a homepage trip, use **Members, bags and permissions → Account for …** to link accounts. Managed trips use confirmed members' account IDs automatically. An organizer cannot confirm another member's readiness.

Changing relevant packing assignments, the required items, or the member roster makes an old confirmation out of date. The displayed group result is recomputed from current packing data and current confirmations. It is a coordination aid, not an automatic check of a physical passport or ticket.

The local demo stores readiness only in this browser. Shared Firestore mode synchronizes members' declarations. Completed managed trips are read-only.

```text
packingTrips/{packingScope}/departureRequirements/{itemId}
packingTrips/{packingScope}/departureConfirmations/{uid}
```

## Two-account verification after publishing

1. As organizer, create a poll; as another member, vote, change and remove your vote. Verify both browsers show the same counts.
2. Close it as the creator/organizer and verify further votes are disabled.
3. Mark an existing packing item as required. Verify an unpacked assigned member cannot confirm.
4. Pack the required assignments and confirm separately in each linked member's account. Verify the group result.
5. Change a required packing status or requirement and verify readiness needs review again.
6. Try an unrelated account: it must not read the group's polls or readiness data.

Local tests and a successful build do not publish Cloud Firestore Rules or verify real browser/account behavior.
