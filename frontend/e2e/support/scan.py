"""Run the worker's own scan once, the way beat would, and print what it filed.

The tests need real proposals in the queue, and the only thing that files them
is the worker's scan - there is deliberately no API to ask for one, because
nothing but the schedule should be creating them. So this runs the same
function beat runs, against the same database the backend under test is using.
Standing in for the worker here, rather than inserting rows by hand, is what
keeps these tests honest about what the worker actually produces.
"""

import asyncio
import json

from app import db
from app.services import proposals as service


async def main() -> None:
    async with db.get_sessionmaker()() as session:
        made = await service.propose(session)
        await session.commit()
        print(json.dumps([{"rule": m.rule, "field": m.field, "to": m.to_value} for m in made]))


asyncio.run(main())
