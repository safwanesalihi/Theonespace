# Parcours client — The One Flow

## Parcours dans l’application

**Client → Pipeline & documents.** Le propriétaire définit le forfait puis crée le devis. Les quantités, les unités, les responsabilités et les conditions sont copiées dans le document. Le client accepte ou refuse depuis **Documents** dans son portail. Un contrat structuré est créé depuis un devis accepté et conserve ses lignes, montants, conditions particulières et règles de collaboration.

Les étapes affichées suivent les documents, le brief et les tâches du mois : cadrage → devis → contrat → brief → plan → production → validation → bilan. Cliquer une étape ouvre son action. Ce parcours guide le travail ; il ne remplace pas le suivi de paiement et ne bloque pas automatiquement toutes les anciennes tâches.

## Informations à compléter avant d’envoyer un devis structuré

| Sujet | Ce qui doit être convenu |
|---|---|
| Parties | Raison sociale, adresse, identifiants et contact du prestataire et du client |
| Livrables | Quantité par format et par mois / prestation, définition et limites de chaque unité |
| Stories | **Un frame = une unité** ; une séquence de cinq frames = cinq unités |
| Reels / carrousels / shooting | Durée, slides, tournage, sous-titres, lieu et frais inclus |
| Réseaux et langues | Plateformes, langues, adaptations, recadrages et reposts inclus ou exclus |
| Responsabilités | Contact qui valide, accès / logo / photos à fournir, community management |
| Conditions | Paiement, début / fin, renouvellement, résiliation, droits d’usage et sources |
| Extras | Tarif par unité ou « sur devis », exclusions et traitement des unités inutilisées |

Les prix sont renseignés par le propriétaire. Aucun tarif commercial réel n’est inventé. Un prix d’extra vide signifie « sur devis » ; zéro est un prix explicitement saisi.

## Demandes supplémentaires

1. Le client soumet une demande dans le portail.
2. Le studio précise le format, la quantité et le traitement **inclus / extra**.
3. Une demande incluse dans un contrat actif est vérifiée contre le quota disponible. Les réservations concurrentes sont sérialisées par client.
4. Le propriétaire peut **Chiffrer un extra**. Ce devis reste un brouillon, lié à la demande et à sa quantité exacte.
5. Il l’envoie depuis la fiche client. Le client accepte explicitement le devis ; le studio peut ensuite accepter la demande et créer la tâche.
6. Un tour supplémentaire après les deux tours inclus met le livrable original en pause et crée une demande extra. Après accord sur son devis, la même tâche reprend, sans doubler le contenu.

Le délai de 48 heures concerne les livrables, **jamais** les devis ni les extras. Une nouvelle direction reste une demande à qualifier par le studio : l’application ne peut pas déduire cette différence d’un texte de retour.

## Décompte

- Les tâches et idées du plan portant un format sont comptées une fois. Une idée promue garde son identité.
- Les idées sans date suivent le mois de leur plan ; les tâches datées suivent leur échéance.
- Chaque nœud Story représente un frame. Une tâche créée depuis une demande peut regrouper plusieurs unités explicites.
- Les programmations sociales et reposts ne consomment pas une seconde fois la création originale.
- Les extras acceptés sont séparés du quota de base. Le travail interne et les éléments archivés sont exclus.
- Les anciennes tâches sans format restent signalées comme non décomptées. Les créations manuelles / imports sont supervisés par le studio ; le blocage de quota porte sur l’acceptation des demandes du portail.

## Confidentialité et versions

Le propriétaire gère les conditions financières. Le client voit ses documents envoyés ; les brouillons et le forfait de travail restent privés. Les autres rôles ne reçoivent pas les données commerciales.

Après envoi, les lignes, montants, périmètre, notes, dates et références sont figés. Un document envoyé ne redevient pas un brouillon. Créer une nouvelle version si l’accord change. L’acceptation conserve l’identité authentifiée, la date, la version et l’origine portail / studio. Une décision enregistrée par le studio est présentée comme telle.

Le portail n’est pas une signature électronique certifiée. Conserver le contrat signé ou la preuve d’accord appropriée. Référence : [DGSSI — loi 43-20](https://www.dgssi.gov.ma/sites/default/files/attached_files/loi_43.20_fr.pdf).

## Livrables visuels

- `output/pdf/client-pipeline.svg` : diagramme éditable, à glisser dans Figma.
- `output/pdf/client-contract-checklist.svg` : checklist éditable.
- `output/pdf/client-pipeline-blueprint.pdf` : parcours et checklist, deux pages.
- `scripts/generate-client-pipeline.py` : source du diagramme (reportlab / svglib).

Les clauses rédigées conservent leur langue contractuelle ; les commandes du parcours sont traduites en français, anglais et arabe.
