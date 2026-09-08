"""In-memory administrator alert endpoints.

The prototype does not have a database or authentication layer yet, so
alerts are held in process memory and reset whenever the server restarts.
This is enough to let the React administrator console send/list alerts
against a real backend route instead of only writing to browser storage.
"""

import uuid

from fastapi import APIRouter, Request

from app.schemas.alert import AlertHistory, AlertOut, AlertRequest

router = APIRouter(prefix="/v1/admin", tags=["admin"])


def _alert_store(request: Request) -> list[AlertOut]:
    store = getattr(request.app.state, "alerts", None)
    if store is None:
        store = []
        request.app.state.alerts = store
    return store


@router.post("/alerts", response_model=AlertOut, status_code=201)
def send_alert(request: Request, payload: AlertRequest):
    store = _alert_store(request)
    alert = AlertOut.from_request(uuid.uuid4().hex, payload)
    store.insert(0, alert)
    return alert


@router.get("/alerts", response_model=AlertHistory)
def list_alerts(request: Request, limit: int = 50):
    store = _alert_store(request)
    return AlertHistory(items=store[:limit], total=len(store))
