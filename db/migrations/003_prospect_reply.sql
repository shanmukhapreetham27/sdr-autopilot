-- What the prospect actually said back.
--
-- The Conversation Agent's whole job is classifying an inbound reply, but the
-- prospect record had nowhere to put one. Its request was built from
-- `last_action` under the heading "INBOUND REPLY", and last_action holds
-- whatever OUR agents last did — so a live agent was being handed the
-- Follow-up Agent's own cadence directives, and in one case the literal text
-- "opened but did not reply", as if the prospect had written them.
--
-- Deliberately separate from last_action rather than overloading it. The two
-- answer different questions: "what did we do" and "what did they say". An
-- agent reasoning about intent must never see the first when it asked for the
-- second.

alter table prospects
  add column last_reply    text,
  add column last_reply_at timestamptz,
  -- Which channel the reply arrived on, so the agent can weigh a two-line SMS
  -- differently from a considered email.
  add column last_reply_channel text
    check (last_reply_channel is null
           or last_reply_channel in ('email','linkedin','sms','voice'));
