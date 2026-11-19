# Registre digital des réclamations – Moyens généraux

Remplace le registre papier tenu par les vigiles : chaque signalement (salle, programme,
type de problème, description) est enregistré, suivi par statut et historisé.

```
registre/
├── backend/   API NestJS + Prisma + PostgreSQL
└── mobile/    App Flutter (Riverpod + go_router)
```

## Rôles

| Rôle              | Signaler | Voir                          | Changer le statut |
|-------------------|:--------:|-------------------------------|:-----------------:|
| `DELEGUE`         | ✅       | ses propres signalements      | ❌                |
| `VIGILE`          | ✅       | les salles de son bâtiment    | ❌                |
| `MOYENS_GENERAUX` | ✅       | tout                          | ✅                |
| `ADMIN`           | ✅       | tout                          | ✅                |

Cycle de vie : `OUVERTE → EN_COURS → RESOLUE` (ou `REJETEE`), une réclamation résolue peut être rouverte.
Chaque transition crée un `ReclamationEvent` (auteur, commentaire, date).

## Backend

```bash
cd backend
cp .env.example .env
docker compose up -d          # PostgreSQL
npm install
npm run db:migrate -- --name init
npm run db:seed               # bâtiments, salles, programmes, 4 comptes de test
npm run start:dev
```

- Swagger : http://localhost:3000/api/docs
- Comptes de test (mot de passe `Passw0rd!`) : `admin@bem.sn`, `mg@bem.sn`, `vigile.a@bem.sn`, `delegue@bem.sn`

| Méthode | Route                          | Accès                    |
|---------|--------------------------------|--------------------------|
| POST    | `/api/auth/login`              | public                   |
| GET     | `/api/auth/me`                 | connecté                 |
| GET     | `/api/buildings`, `/api/programs` | connecté              |
| GET     | `/api/reclamations?status=&category=&buildingId=&page=&limit=` | connecté (filtré par rôle) |
| POST    | `/api/reclamations`            | connecté                 |
| GET     | `/api/reclamations/:id`        | connecté (filtré par rôle) |
| PATCH   | `/api/reclamations/:id/status` | `ADMIN`, `MOYENS_GENERAUX` |
