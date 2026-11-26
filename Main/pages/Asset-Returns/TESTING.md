# Asset Returns acceptance tests

Only files in this component were changed. Use connected mode at http://localhost:3000/returns after logging in. At least one outstanding loan is needed; create it through the existing Borrowing page. Sample mode remains isolated and does not exercise connected corrections, scheduling, or email delivery.

| Scenario | Manual procedure | Expected result |
| --- | --- | --- |
| TS1.1A | Select an outstanding loan, choose a valid condition/status, enter inspection notes, confirm receipt, and submit. To test a later correction, select Correct history, enter a corrected condition/notes and a reason, then save. | Return or correction is saved and displayed. The original inspection is retained. |
| TS1.1B | Leave the inspection confirmation unchecked or omit a required correction reason. The automated tests also submit an unsupported condition directly to the API. | Validation rejects the request. No partial history changes are saved. |
| TS1.2A | Complete a return/correction, use Refresh records, then reload the page. | The saved values are still displayed. Corrected history does not overwrite current inventory. |
| TS1.2B | Check Show overdue assets only and search for `<script>` or enter more than 100 characters. Also search for a valid nonexistent asset. | Invalid input produces a validation message. A valid unmatched search produces No loans match your search. |
| TS1.3A | Complete a valid return. In Email content and delivery evidence, select Preview content. With email configured, use Send email or wait for the worker, then open the test inbox link if present. | The confirmation contains the previous and returned conditions, borrower recipient, and asset tag. Status is Captured for Ethereal, Sent for SMTP acceptance, or Failed on delivery error. |
| TS1.3B | Submit an incomplete return. Automated tests also send a malformed condition directly. | No return record or confirmation email is created. |
| TS1.4A | For a different outstanding loan, schedule Borrowed, Overdue, and Missing reminders one, two, and three minutes in the future. Wait or use Check due reminders now and refresh. | Each label is administered no earlier than its date. Its email becomes Pending, then Captured/Sent when configured. Repeating the check does not resend completed emails. |
| TS1.4B | Enter a past date, invalid date, or dates out of sequence. | Browser/server validation rejects the schedule without saving any of its dates. |

## Custom-date interpretation

These dates control Returns reminder labels and their emails. They do not change the Borrowing component's due-date rules or replace its scheduled status checks. The original Borrowing code has not been modified. Unsent Returns reminders are cancelled when the equipment is checked in. Once a reminder has started processing, the schedule cannot be replaced.

## Email configuration

Content previews always work with saved connected records. No external email is sent unless a transport is explicitly configured.

For a test inbox, stop the server, then set this in PowerShell before running the normal project startup command:

```powershell
$env:ETHEREAL_EMAIL = '1'
npm.cmd start
```

Ethereal captures messages for inspection; it does not deliver them to a real recipient. Use fictional borrower data for tests. For real delivery use the university-approved SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and MAIL_FROM settings. SMTP_SECURE defaults to true; false uses STARTTLS where appropriate. An email marked Sent has been accepted by the mail service; inbox arrival is not guaranteed by this status.

Return confirmation content is stored in the same transaction as the return. Delivery happens afterward, outside the database lock. The worker checks every five seconds while the server is running, and overdue scheduled reminders are picked up after restart. The application must remain running for automatic processing. Failed emails can be retried from the page. Sending-state recovery after a process crash is not automatic; such records require operational review before retry to avoid duplicate delivery.

## Automated tests

From the repository root:

```powershell
node --test Main/pages/Asset-Returns/returnFeature.test.js
```

The tests use isolated SQLite records, a controllable clock, and a mock email sender. They do not send external messages. Test scenarios assert rejection of invalid data, saved corrections, email before/after content, custom reminder timing, past-date rejection, duplicate prevention, and cancellation after return.
