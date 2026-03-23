from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./exam_translator.db")
TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "")

# Turso uses libsql:// or libsqls:// scheme — map to sqlite+libsql for SQLAlchemy
if DATABASE_URL.startswith("libsql") or DATABASE_URL.startswith("https://"):
    # Turso remote connection via libsql driver
    from libsql_experimental import connect as libsql_connect
    creator = lambda: libsql_connect(DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    engine = create_engine("sqlite+libsql://", creator=creator)
    connect_args = {}
else:
    connect_args = {"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
    engine = create_engine(DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from .models import Question, Translation  # noqa: F401
    Base.metadata.create_all(bind=engine)
