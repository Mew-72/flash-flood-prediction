import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Generic, Hashable, TypeVar

T = TypeVar("T")


@dataclass
class _Entry(Generic[T]):
    value: T
    expires_at: float


class AsyncTTLCache(Generic[T]):
    """Bounded TTL cache that coalesces concurrent work for the same key."""

    def __init__(self, max_entries: int, ttl_seconds: float):
        if max_entries <= 0:
            raise ValueError("max_entries must be positive")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._entries: OrderedDict[Hashable, _Entry[T]] = OrderedDict()
        self._inflight: dict[Hashable, asyncio.Task[T]] = {}
        self._lock = asyncio.Lock()

    async def get_or_create(
        self, key: Hashable, factory: Callable[[], Awaitable[T]]
    ) -> T:
        async with self._lock:
            now = time.monotonic()
            entry = self._entries.get(key)
            if entry is not None and entry.expires_at > now:
                self._entries.move_to_end(key)
                return entry.value
            if entry is not None:
                del self._entries[key]

            task = self._inflight.get(key)
            if task is None:
                task = asyncio.create_task(self._produce(key, factory))
                self._inflight[key] = task

        return await asyncio.shield(task)

    async def _produce(
        self, key: Hashable, factory: Callable[[], Awaitable[T]]
    ) -> T:
        try:
            value = await factory()
            async with self._lock:
                self._entries[key] = _Entry(
                    value=value, expires_at=time.monotonic() + self._ttl_seconds
                )
                self._entries.move_to_end(key)
                while len(self._entries) > self._max_entries:
                    self._entries.popitem(last=False)
            return value
        finally:
            async with self._lock:
                self._inflight.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._entries.clear()

    @property
    def size(self) -> int:
        return len(self._entries)
