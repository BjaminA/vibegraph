# LedgerHub

LedgerHub is a document store whose zones can be shared between organisations' nodes.

## Sharing

A shared zone is synchronised to every node it is shared with, in both directions: a write on either node appears on the other.
Use shareZone to share a zone with another node.
Synchronisation copies documents as they are; it does not check who wrote them.

## Documents

Use writeDoc to write a document into a zone. readDoc returns a document from a zone.
watchDoc calls you back for every document that changes in a zone.
