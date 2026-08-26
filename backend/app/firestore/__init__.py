"""Firestore 데이터 접근 계층.

FastAPI+PostgreSQL에서 Firebase(Firestore)로 이관하는 과정에서 새로 추가되는
패키지. 기존 app/models(SQLAlchemy ORM), app/db.py(SQLAlchemy 엔진)와는
완전히 별개이며 서로 의존하지 않는다.
"""
