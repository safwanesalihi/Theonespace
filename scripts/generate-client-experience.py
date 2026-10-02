"""Create the agency/client operating guide from the implemented application workflow."""
from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, Flowable
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf'
OUT.mkdir(parents=True, exist_ok=True)
FILE = OUT / 'client-agency-experience-a-to-z.pdf'
INK, MUTED, GOLD, PALE, GRAY, LINE = [HexColor(v) for v in ['#20232b','#59616e','#d4af37','#faf6e7','#f4f5f7','#e1e4e9']]
W, H = A4
CW = W - 84
N = 16
S = {
 'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10, leading=15, textColor=INK, spaceAfter=6),
 'small': ParagraphStyle('small', fontName='Helvetica', fontSize=8.6, leading=12.5, textColor=MUTED, spaceAfter=4),
 'lead': ParagraphStyle('lead', fontName='Helvetica', fontSize=11.7, leading=17, textColor=MUTED, spaceAfter=14),
 'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=24, leading=29, textColor=INK, spaceAfter=10),
 'section': ParagraphStyle('section', fontName='Helvetica-Bold', fontSize=12, leading=16, textColor=INK, spaceBefore=12, spaceAfter=7),
 'kicker': ParagraphStyle('kicker', fontName='Helvetica-Bold', fontSize=9, leading=12, textColor=HexColor('#765b14'), spaceAfter=8),
 'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=9.3, leading=14, textColor=INK),
 'compact': ParagraphStyle('compact', fontName='Helvetica', fontSize=9.3, leading=12.5, textColor=INK),
 'head': ParagraphStyle('head', fontName='Helvetica-Bold', fontSize=9, leading=13, textColor=INK),
}
def P(text, style='body'): return Paragraph(text, S[style])
flow = []
def title(kicker, heading, intro):
 flow.extend([P(kicker.upper(), 'kicker'), P(heading, 'title'), P(intro, 'lead')])
def section(heading, *lines):
 flow.append(P(heading, 'section'))
 for line in lines: flow.append(P(line))
def note(label, text):
 table = Table([[P(label.upper(), 'kicker')], [P(text)]], colWidths=[CW])
 table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),.6,HexColor('#eadba4')),('LEFTPADDING',(0,0),(-1,-1),13),('RIGHTPADDING',(0,0),(-1,-1),13),('TOPPADDING',(0,0),(-1,0),11),('BOTTOMPADDING',(0,-1),(-1,-1),9)]))
 flow.extend([Spacer(1,10),KeepTogether(table)])
def grid(headers, rows, widths=None, compact=False):
 widths = widths or [CW/len(headers)]*len(headers)
 cells = [[P(x,'head') for x in headers]]+[[P(str(x),'compact' if compact else 'cell') for x in row] for row in rows]
 padding = 6 if compact else 9
 table = Table(cells,colWidths=widths,repeatRows=1,hAlign='LEFT')
 table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('ROWBACKGROUNDS',(0,1),(-1,-1),[white,GRAY]),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),.6,LINE),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),padding),('BOTTOMPADDING',(0,0),(-1,-1),padding)]))
 flow.extend([table,Spacer(1,5)])
def sides(agency, client):
 grid(['AGENCE / STUDIO','CLIENT'],[[agency,client]])
def path(text): flow.extend([P('DANS L’APP', 'kicker'),P(text,'small')])
def nextpage(): flow.append(PageBreak())
class Pipeline(Flowable):
 def __init__(self): super().__init__();self.width=CW;self.height=148
 def draw(self):
  c=self.canv; labels=['Cadrage','Devis','Contrat','Brief','Plan','Production','Validation','Bilan']
  cw=(CW-30)/4; ch=49
  for i,label in enumerate(labels):
   row=i//4;col=i%4 if row==0 else 3-i%4;x=col*(cw+10);y=88-row*72
   c.setFillColor(white);c.setStrokeColor(LINE);c.roundRect(x,y,cw,ch,9,stroke=1,fill=1)
   c.setFillColor(HexColor('#765b14'));c.setFont('Helvetica',8);c.drawString(x+11,y+32,f'{i+1:02d}')
   c.setFillColor(INK);c.setFont('Helvetica-Bold',10);c.drawString(x+11,y+14,label)
   if i<7:
    c.setStrokeColor(GOLD);c.setFillColor(GOLD)
    if i==3: ax=x+cw/2;ay=y-3;bx=ax;by=y-18
    else: ax=x+cw+2 if row==0 else x-2;ay=y+ch/2;bx=ax+6 if row==0 else ax-6;by=ay
    c.line(ax,ay,bx,by);p=c.beginPath();p.moveTo(bx,by)
    if i==3:p.lineTo(bx-2.5,by+4);p.lineTo(bx+2.5,by+4)
    elif row==0:p.lineTo(bx-4,by+2.5);p.lineTo(bx-4,by-2.5)
    else:p.lineTo(bx+4,by+2.5);p.lineTo(bx+4,by-2.5)
    p.close();c.drawPath(p,fill=1,stroke=0)

# 01 - Overview and navigation.
title('Guide opérationnel | 02 octobre 2026','Agence & client.<br/>Le parcours de A à Z.','Comment cadrer la relation, formaliser l’offre, produire, faire valider et livrer dans The One Space.')
flow.append(Pipeline())
note('La règle qui protège la relation','Un périmètre écrit, des unités compréhensibles et un accord enregistré. <b>1 frame de story = 1 unité.</b> Un devis ou un extra nécessite une acceptation explicite.')
section('Utiliser ce guide','Chaque étape indique ce que fait l’agence, ce que fait le client, où agir dans l’app et ce qui permet de passer à la suite. Les étapes commerciales préalables sont une procédure d’agence ; les contrôles automatiques sont précisés page 15.')
grid(['PRÉPARER','PRODUIRE','TERMINER'],[['p. 2 : parcours et rôles<br/>p. 3 : premier contact<br/>p. 4 : périmètre<br/>p. 5 : devis et TVA<br/>p. 6 : contrat et démarrage','p. 7 : brief et accès<br/>p. 8 : plan mensuel<br/>p. 9 : tâches et équipe<br/>p. 10 : validation<br/>p. 11 : extras','p. 12 : publication et réunions<br/>p. 13 : facture et paiement<br/>p. 14 : bilan et renouvellement<br/>p. 15 : incidents et contrôles<br/>p. 16 : routines et messages']])
flow.append(P('Les volumes et montants d’exemple sont fictifs. Renseignez vos propres offres, tarifs et conditions. Guide en français, avec les libellés de l’interface française.', 'small'))
nextpage()

# 02 - Roles and handovers.
title('01 | Vue d’ensemble','Qui fait quoi, et quand ?','L’agence pilote la prestation. Le client apporte les informations, lit ses accords et valide les livrables.')
grid(['ÉTAPE','AGENCE','CLIENT'],[
 ['Cadrage','Préciser le besoin et les unités.','Confirmer objectifs, réseaux et interlocuteur.'],
 ['Devis','Chiffrer, choisir TVA ou Sans TVA, envoyer.','Lire quantités, prix et conditions ; accepter ou refuser.'],
 ['Contrat','Créer depuis le devis accepté.','Vérifier et confirmer l’accord.'],
 ['Brief / plan','Compléter le brief ; partager le plan.','Fournir les éléments ; commenter le plan.'],
 ['Production','Assigner ; créer ; déposer le livrable.','Répondre aux questions dans la tâche.'],
 ['Validation','Envoyer et suivre les retours.','Approuver ou demander un tour consolidé.'],
 ['Publication / bilan','Publier, facturer, vérifier le résultat.','Suivre le calendrier et payer selon l’accord.'],
], [87,212,CW-299])
section('Les rôles dans l’app','<b>Propriétaire :</b> création des clients et documents commerciaux ; gestion du forfait et des prix. <b>Administrateur :</b> pilotage des clients existants, tâches, échéances et équipe. Les documents financiers sont réservés au propriétaire et au client concerné.','<b>Membre :</b> tâches assignées ou disponibles, fichiers et conversation. <b>Social media manager :</b> opérations Social et statistiques. <b>Client :</b> son portail et ses propres contenus/documents. L’opérateur impression travaille dans l’espace Impression.')
note('Deux accords différents','<b>Accord commercial :</b> devis, contrat, extra ; réponse explicite.<br/><b>Validation d’un livrable :</b> contenu précis ; retours, reçu et délai de 48 h selon les règles convenues. Ne mélangez pas ces deux décisions.')
nextpage()

# 03 - Intake and invitation.
title('02 | Premier contact','Ouvrir une relation propre.','Avant le premier devis, obtenir un besoin précis et un interlocuteur qui peut répondre au nom du client.')
path('Propriétaire : Clients > Ajouter un client. Puis Équipe > Inviter > rôle Client > choisir sa fiche.')
sides('Créer la fiche : nom, contact, e-mail, WhatsApp, langue, description et identité visuelle disponible. Recueillir les objectifs et la période souhaitée. Inviter le contact client dans le bon espace.', 'Désigner la personne qui valide. Se connecter avec les identifiants de l’invitation et choisir son mot de passe à la première connexion. Vérifier que le portail affiche la bonne entreprise.')
section('Questions à poser dès le départ','1. Que veut-on obtenir : notoriété, demandes, trafic, lancement ? Pour quelle audience ?','2. Quelles plateformes et langues ? Qui fournit les photos, produits, textes et accès ?','3. Quels volumes, quelle durée de collaboration et quelle date de publication ? Qui consolide les retours ?','4. Quels services sont réellement inclus : création, adaptation, tournage, publication, réponses aux messages, reporting ?')
section('Préparer l’accueil','Partager une explication courte du portail : <b>Documents</b> pour les accords, <b>À valider</b> pour les livrables et <b>Demander un contenu</b> pour les nouvelles demandes. Une notification WhatsApp alerte le contact ; la tâche et les décisions restent consultables dans le portail.')
note('Prêt à passer au cadrage','La bonne fiche client existe, le bon contact a accès au portail, et les besoins / délais sont suffisamment clairs pour construire l’offre. L’invitation est nécessaire pour accepter un document directement depuis le portail.')
nextpage()

# 04 - Scope definitions.
title('03 | Périmètre','Écrire ce que vous vendez.','Le forfait de travail devient la référence du devis et du contrat. Une promesse orale doit devenir une quantité ou une condition explicite.')
path('Client > Pipeline & documents > Définir le forfait.')
grid(['À RENSEIGNER','EXEMPLE DE DÉFINITION'],[
 ['Parties / période','Raison sociale, adresse, identifiants et contact ; mensuel ou ponctuel ; début / fin.'],
 ['Post','Un visuel original et sa légende ; formats et langues inclus.'],
 ['Carrousel','Une création avec un nombre maximal de slides défini.'],
 ['Reel','Durée maximale ; tournage inclus ou non ; montage, sous-titres et adaptations.'],
 ['Story','Un frame = une unité. Une séquence de 5 frames consomme 5 unités.'],
 ['Shooting','Une séance : durée, lieu, équipe, déplacements et livrables inclus.'],
 ['Services / limites','Plateformes, langues, reposts, community management, exclusions, inputs et contact de validation.'],
 ['Conditions','Paiement, renouvellement, résiliation, droits d’usage / sources, report d’unités, tarifs d’extras ou sur devis.'],
], [116,CW-116])
section('Un exemple qui évite le conflit','Un forfait fictif comprend <b>20 frames de story par mois</b>. Quatre séquences de cinq frames utilisent les 20 unités. Une publication du même fichier sur un second réseau ne devient pas une seconde création ; les adaptations et reposts doivent être précisés séparément dans l’accord.')
note('Décision de cadrage','Une quantité de 0 signifie non inclus. Un prix d’extra vide signifie <b>sur devis</b>. Un prix saisi à 0 signifie gratuit. Le client doit pouvoir expliquer ce qu’il reçoit avant d’accepter le devis.')
nextpage()

# 05 - Quote and tax.
title('04 | Offre','Devis : prix, TVA et accord.','Le propriétaire prépare l’offre. Le client décide sur cette version précise, avec ses quantités et conditions.')
path('Client > Pipeline & documents > Préparer le devis / Nouveau. Portail client > Documents > Répondre au document.')
sides('Créer le devis depuis le périmètre. Renseigner les lignes et prix, les dates, la validité et les notes particulières. Choisir <b>TVA</b> ou <b>Sans TVA</b>. Contrôler le PDF, puis passer le statut à Envoyé.', 'Ouvrir le document envoyé. Lire les unités, les prix, le traitement de TVA, les inclusions et exclusions. Cocher la confirmation de lecture, puis Accepter le document ou Refuser.')
grid(['CHOIX','CALCUL','EXEMPLE FICTIF'],[
 ['TVA','Taux renseigné ; total = base + TVA. Le taux est modifiable.','Base 1 000 MAD, exemple 20 % : TVA 200 MAD, total 1 200 MAD.'],
 ['Sans TVA','Taux enregistré à 0 ; aucun montant de TVA ajouté.','Base 1 000 MAD : total à payer 1 000 MAD.'],
], [84,225,CW-309])
section('Une version claire','Avant d’envoyer un devis structuré, compléter les parties, quantités, plateformes, langues, date de début, contact et conditions. Une fois envoyé, le périmètre, les lignes, la TVA, les dates et les notes sont figés.','Si le client refuse ou demande une offre différente, créer une nouvelle version et la faire accepter. Si le devis est expiré, le client ne peut pas l’accepter : préparer une offre valable. Le silence ne vaut pas acceptation commerciale.')
note('Passage au contrat','Le devis est accepté explicitement. L’app conserve l’auteur, la date et l’origine de la décision. Une décision saisie par le propriétaire depuis le studio est identifiée comme telle.')
nextpage()

# 06 - Contract and start.
title('05 | Engagement','Contrat et conditions de démarrage.','Le contrat reprend l’offre acceptée. Le lancement dépend ensuite de votre procédure de paiement et de réception des éléments.')
path('Client > Pipeline & documents > devis accepté > Créer le contrat. Client : Documents > lire et répondre.')
sides('Créer le contrat depuis le devis accepté. Vérifier les mêmes lignes, montants, TVA / Sans TVA, périmètre et notes. Envoyer le contrat. Vérifier le paiement convenu avant d’autoriser le démarrage.', 'Contrôler la période, les obligations de chacun, les droits, les échéances et les limites. Confirmer le contrat. Effectuer l’acompte ou le paiement prévu et transmettre les éléments demandés.')
section('Ce qui doit être clair dans l’accord','<b>Livrables :</b> volumes, unités, définitions, adaptations et limites. <b>Validation :</b> contact responsable, retours consolidés, deux tours inclus et règle de 48 h applicable aux livrables.','<b>Calendrier :</b> date de départ, rythme de livraison, délais d’accès et d’informations, gel à J-7, gestion d’un retard ou d’une exception.','<b>Commercial :</b> prix, TVA ou Sans TVA, paiement, extras, unités inutilisées, renouvellement et résiliation. <b>Droits :</b> usage autorisé, fichiers finaux, sources et éléments tiers à préciser.')
section('Le feu vert agence','Utiliser une checklist de lancement : devis accepté, contrat confirmé, paiement prévu vérifié, interlocuteur désigné et éléments indispensables reçus. L’app ne réalise pas le paiement et ne transforme pas cette checklist en blocage automatique de toutes les tâches.')
note('Preuve d’accord','Le portail enregistre une décision authentifiée ; il ne fournit pas de signature électronique certifiée. Conserver le contrat signé ou la preuve d’accord appropriée avec les documents de la relation.')
nextpage()

# 07 - Brief and accounts.
title('06 | Onboarding','Brief, identité et comptes.','Une production claire commence avec un brief utilisable par toute l’équipe et des accès aux bonnes plateformes.')
path('Client > Aperçu > Brief de marque. Portail client > Explorer le brief / Mes réseaux.')
grid(['SECTION DU BRIEF','CE QUE L’AGENCE FIXE AVEC LE CLIENT'],[
 ['La marque','Positionnement, offre, contexte, message et particularités.'],
 ['Identité visuelle','Couleurs, typographie, direction visuelle, à privilégier / à éviter.'],
 ['Objectifs','Objectif nommé et mesure de réussite, cohérents avec la prestation.'],
 ['Audience & ton','Public cible, langues, ton et formulations à éviter.'],
 ['Exigences','Informations obligatoires, contraintes de marque et priorités.'],
 ['Références','Liens de référence identifiés ; expliquer ce qui est apprécié.'],
], [115,CW-115])
sides('Compléter le brief, importer / exporter le JSON si utile et centraliser logos, photos et références. Identifier les informations manquantes. Faire confirmer les choix avant de préparer le plan.', 'Lire le brief et signaler les erreurs. Fournir les fichiers et informations requis. Connecter ses propres comptes via Mes réseaux, suivre le parcours officiel et choisir les comptes concernés.')
section('Préparer la publication','Le studio vérifie que les comptes connectés sont ceux du client et correspondent aux destinations convenues. La connexion se fait par le parcours des plateformes ; le client n’a pas à communiquer son mot de passe au studio. Si un compte doit être reconnecté, résoudre cet accès avant l’échéance de publication.')
note('Prêt pour le plan','Identité, audience, objectifs et exigences compris ; contenus sources accessibles ; destinations identifiées et accès disponibles pour la publication.')
nextpage()

# 08 - Calendar.
title('07 | Planification','Préparer le mois, pas des urgences.','Le plan éditorial transforme le forfait en contenus datés. Le client voit uniquement les plans partagés avec lui.')
path('Client > Plan Éditorial : préparer et partager le mois. Client : Plan éditorial / Calendrier.')
sides('Créer le plan du mois avec branches, formats, dates et notes. Rapprocher ses volumes du contrat actif. Un nœud Story représente un frame. Promouvoir les idées en tâches quand elles passent en production.', 'Lire le plan partagé, vérifier les événements et informations, puis commenter le contenu concerné. Utiliser le calendrier pour voir ce qui est prévu jour par jour.')
grid(['REPÈRE','ACTION ATTENDUE','EXEMPLE : PUBLICATION LE 30 OCT. 2026'],[
 ['J-14','Brief et informations validés.','16 octobre'],
 ['J-7','Livrable envoyé ; calendrier gelé.','23 octobre'],
 ['J-5','Validation client attendue.','25 octobre'],
 ['J-1','Fichier et publication prêts.','29 octobre'],
 ['Jour J','Publication puis vérification.','30 octobre'],
], [63,233,CW-296])
section('Rapprocher le plan du forfait','Les tâches et idées classées sont décomptées une fois ; une idée promue garde son identité. Une idée sans date suit le mois du plan ; une tâche datée suit son échéance. Les extras acceptés sont séparés du forfait de base.','Vérifier les tâches sans format et les créations manuelles / imports : ils nécessitent une revue studio. À moins de sept jours de la publication, l’ajout ou le changement de date suit le contrôle J-7 et l’exception confirmée par un responsable.')
note('Plan prêt','Les volumes sont cohérents, les formats et dates sont identifiés, les dépendances sont connues et le client a pu consulter le plan partagé.')
nextpage()

# 09 - Work.
title('08 | Production','Une tâche, un responsable, un livrable.','L’agence garde la production lisible. La conversation est attachée au contenu auquel elle se rapporte.')
path('Client > Tâches > ouvrir la tâche. Équipe > contact du membre > WhatsApp si les notifications sont utilisées.')
sides('Définir titre, client, sous-projet, responsable, priorité, date et brief. Vérifier format / quantité et statut inclus ou extra accepté. Assigner le membre. Déposer la bonne version du livrable.', 'Répondre aux questions et fournir les informations manquantes dans la conversation. Mentionner un participant autorisé si une réponse précise est attendue. Suivre la progression dans son portail.')
grid(['STATUT','SIGNIFICATION OPÉRATIONNELLE'],[
 ['À faire','Contenu à démarrer ; informations et personne responsable identifiées.'],
 ['En cours','Production en cours ; suivre le temps si nécessaire.'],
 ['En pause','Travail suspendu : dépendance, élément manquant ou extra en attente.'],
 ['À valider','Version mise à disposition du client pour décision.'],
 ['Validé','Contenu approuvé ; publication encore à préparer / vérifier.'],
], [104,CW-104])
section('Notifications utiles','Un numéro WhatsApp de membre peut servir à l’alerte d’assignation. Le numéro du client sert à l’alerte de validation si le canal est configuré. Le portail reste l’endroit où consulter le fichier, les retours et la décision.','Les mentions dans la tâche sont limitées aux participants autorisés : propriétaire, administrateurs, client concerné et personne assignée. Un message dans le chat complète le suivi ; une demande formelle de modifications doit utiliser l’action de validation.')
note('Contrôle avant envoi','Vérifier noms, chiffres, orthographe, langue, formats, durée, marque, liens et destination. Envoyer au client un livrable qu’il peut ouvrir et examiner.')
nextpage()

# 10 - Review.
title('09 | Validation','Rendre la décision simple et traçable.','Le client choisit entre approuver la version et envoyer un ensemble clair de retours.')
path('Agence : tâche > envoyer en validation. Client : À valider > ouvrir le livrable > Approuver / Demander des modifications.')
sides('Mettre le livrable à disposition. Suivre l’échéance, répondre aux questions et traiter les retours dans la tâche. Vérifier le reçu final : accord client, validation tacite ou accord consigné par le studio.', 'Ouvrir le fichier original, vérifier les informations et regrouper tous les retours. Pour un contenu conforme, confirmer l’approbation. Pour des changements, envoyer un tour consolidé via Demander des modifications.')
section('Les deux tours inclus','Un tour correspond à un envoi consolidé de retours via l’action dédiée, pas à chaque phrase ni à chaque message de chat. Deux tours sont inclus par livrable selon les règles de collaboration. Les changements sont réalisés, puis une nouvelle version est présentée au client.','Après les tours inclus, une nouvelle demande de retouche sur un contrat actif met le livrable en pause et ouvre une demande extra. Le studio chiffre le tour avant de reprendre la même tâche.')
section('La règle de 48 h','Le délai démarre quand le livrable est envoyé en validation. Sans réponse à l’échéance, la règle convenue permet une validation tacite appliquée par le traitement des horloges. Un nouveau tour arrête la validation de la version en cours.','Cette horloge ne concerne <b>ni un devis, ni un contrat, ni un extra</b>. Ceux-ci attendent une réponse commerciale explicite. Un « Validé » signifie un accord sur le contenu ; il ne signifie pas que le contenu a déjà été publié.')
note('Responsabilité client','Avant d’approuver, vérifier les prix, dates, coordonnées, allégations, noms et informations métier. Envoyer toutes les remarques du tour ensemble pour que l’équipe puisse exécuter une version cohérente.')
nextpage()

# 11 - Extras.
title('10 | Hors forfait','Un extra suit son propre accord.','Nouveau contenu, volume supplémentaire, nouvelle direction ou tour supplémentaire : qualifier avant de produire.')
path('Client : Demander un contenu. Studio : Demandes > Chiffrer un extra. Puis fiche client > envoyer le devis extra.')
grid(['ÉTAPE','ACTION'],[
 ['1. Demande','Le client décrit le besoin, les plateformes et la date souhaitée dans le portail.'],
 ['2. Qualification','Le studio classe inclus / extra et précise format + quantité. Une demande incluse est vérifiée contre le quota du contrat actif.'],
 ['3. Devis extra','Le propriétaire choisit le bon format et la quantité exacte, saisit le vrai prix et TVA / Sans TVA. Le devis est lié à cette demande.'],
 ['4. Accord','Le client lit et accepte explicitement le document envoyé. Une discussion seule ne débloque pas la demande extra.'],
 ['5. Reprise','Le studio choisit le devis accepté et crée la tâche extra, ou reprend le livrable original pour un tour supplémentaire.'],
], [97,CW-97])
section('Cas concret : cinq frames supplémentaires','Les 20 frames fictivement incluses sont déjà prévues. Le client demande une séquence de 5 frames. Devis extra : <b>format Story, quantité 5, prix unitaire renseigné par vous</b>. Après acceptation, créer une tâche de 5 unités en extra. Ce supplément ne consomme pas de nouveau le quota de base.')
section('Cas concret : troisième tour','Le devis extra porte sur <b>un tour supplémentaire</b>, format Autre, quantité 1. Après accord, cliquer Reprendre le livrable : la tâche d’origine reprend et son compteur de tours avance. Une nouvelle direction créative reste à qualifier humainement comme un nouveau besoin.')
note('Si le client refuse','Expliquer la limite et proposer de rester dans le périmètre accepté. Garder l’extra hors production. Un supplément accepté dans le mois ne modifie pas automatiquement le forfait récurrent du mois suivant.')
nextpage()

# 12 - Publication and meetings.
title('11 | Exécution finale','Publier, vérifier et se réunir.','Après validation, l’équipe prépare la diffusion sur les bonnes destinations et contrôle ce qui est réellement en ligne.')
path('Studio : Social > publication / programmation / statistiques. Client : Calendrier, Mes réseaux, Statistiques, Réunions.')
sides('Vérifier compte, média, légende, langue et horaire. Si la validation de publication est activée pour ce client, attendre son accord sur le post social. Publier ou programmer, puis contrôler le résultat par réseau.', 'Relire les publications soumises à validation. Suivre le calendrier et les statistiques disponibles. Reconnecter un compte si demandé. Participer à la réunion depuis son portail.')
section('Validation du fichier et publication sociale','La validation d’une tâche concerne le livrable. L’écran Social gère ses propres posts, destinations, programmation et, lorsque configurée, validation client. Une tâche approuvée ne crée pas automatiquement toutes les publications sur tous les réseaux.','En cas d’échec ou de publication partielle, vérifier le résultat de chaque réseau, résoudre la cause et reprendre les destinations concernées. Conserver la trace de la version / du lien réellement publié. Ne comptez pas une programmation ou un repost comme une deuxième création.')
section('Réunions : fin et annulation','Planifier la réunion avec les bons participants et son sujet ; le client rejoint depuis Réunions. Pour une réunion tenue, utiliser <b>Terminer</b> afin qu’elle compte comme terminée. Utiliser Annuler pour une réunion qui n’aura pas lieu. Les décisions importantes doivent ensuite être reportées dans le document ou la tâche concernés.')
note('Prêt pour le bilan','Les publications sont vérifiées, les éléments livrés sont accessibles et les décisions issues des échanges / réunions ont une trace consultable dans l’app.')
nextpage()

# 13 - Billing.
title('12 | Facturation','Facturer l’accord, suivre le règlement.','Le propriétaire émet la facture. Le client lit le montant et paie suivant les conditions qu’il a acceptées.')
path('Client > Pipeline & documents > Bilan > Préparer la facture, ou Nouveau > Facture. Client : Documents > Télécharger.')
sides('Créer la facture, vérifier les lignes, TVA / Sans TVA, échéance et notes. Si créée depuis le devis accepté, elle reprend son périmètre et ses montants. Envoyer le document ; marquer Payé après vérification du règlement.', 'Télécharger la facture et vérifier les références, le total et l’échéance. Payer selon les modalités convenues. Signaler toute question au studio avec le numéro du document.')
section('Relier les montants au travail','Facturer le forfait et les extras approuvés selon votre accord. Si un paiement partiel, acompte ou échéancier est convenu, l’écrire dans les conditions et suivre ses encaissements : le statut d’une facture n’est pas un prélèvement automatique.','Un devis n’est pas une facture. Un contrat n’est pas un paiement. Une notification n’est pas une preuve de règlement. Le propriétaire reste responsable du rapprochement entre l’accord, la facture et l’encaissement réel.')
grid(['VÉRIFICATION','CE QUE VOUS CONTRÔLEZ'],[
 ['Destinataire','Bon client, identité de facturation et contact.'],
 ['Montants','Quantité × prix ; suppléments acceptés ; TVA ou Sans TVA ; total à payer.'],
 ['Dates','Émission, échéance et période facturée.'],
 ['État','Brouillon avant revue ; Envoyé pour le client ; Payé après règlement vérifié.'],
 ['Archive','Document envoyé conservé ; nouvelle version si l’accord change.'],
], [113,CW-113])
note('Espace Impression','Les documents d’impression proposent le même choix de TVA. Les commandes, revenus et dépenses de cet espace ont leur propre suivi ; le portail client de contenu et les quotas sociaux concernent l’espace studio.')
nextpage()

# 14 - Renewal and close.
title('13 | Continuité','Bilan, renouvellement ou clôture.','La fin du mois est un point de décision : ce qui a été réalisé, ce qui reste et ce qui sera vendu pour la période suivante.')
sides('Rapprocher les contenus prévus, validés et publiés des volumes convenus. Séparer les extras et les impayés. Lire les statistiques par rapport aux objectifs du brief. Préparer un bilan simple et des ajustements motivés.', 'Valider les informations du bilan, signaler les besoins du prochain mois et confirmer la suite. Régler les documents dus et récupérer les livrables prévus dans l’accord.')
section('Renouveler proprement','1. Réviser les objectifs, réseaux, formats et quantités de la prochaine période.','2. Modifier le forfait de travail puis créer un nouveau devis. Les documents déjà envoyés gardent leur version ; un ancien accord accepté ne devient pas automatiquement une nouvelle offre.','3. Faire accepter l’offre, créer / confirmer le contrat correspondant et préparer le prochain plan. Les unités inutilisées sont reportées uniquement si les conditions le prévoient par écrit.','4. Si le contrat n’est pas encore actif ou sa période est terminée, vérifier le nouvel accord avant de considérer ses quotas comme la référence courante.')
section('Clôturer sans perdre la trace','Vérifier le préavis et la fin de contrat convenus ; terminer les livrables engagés ; rapprocher paiements et extras ; remettre les fichiers selon les droits acceptés. Décider du sort des programmations futures et des accès connectés. Archiver les dossiers à conserver ; traiter séparément toute suppression définitive.')
note('Le bilan n’est pas une garantie de résultat','Mesurer les livraisons et la performance observée face aux objectifs convenus. Promettre précisément les prestations et les moyens inclus, puis discuter des chiffres avec le client.')
nextpage()

# 15 - Exceptions and limits.
title('14 | Exceptions','Comment traiter les blocages.','Choisir une action claire, l’attribuer à la bonne personne et garder l’accord dans le bon endroit.')
grid(['SITUATION','RÉPONSE AGENCE / CLIENT'],[
 ['« Je pensais avoir 20 séquences »','Relire la définition : 20 frames, pas 20 séries. Montrer les unités déjà prévues et chiffrer la quantité supplémentaire.'],
 ['Repost ou adaptation ?','Appliquer la ligne de périmètre acceptée. Une création originale ne se recompte pas automatiquement à chaque destination.'],
 ['Demande urgente à J-3','Étudier capacité et accès ; faire confirmer une exception J-7 par un responsable. Chiffrer si hors forfait.'],
 ['Photos / informations en retard','Mettre la dépendance par écrit dans la tâche ; confirmer le nouvel échéancier et les conditions prévues.'],
 ['Retours dispersés','Demander un seul envoi consolidé dans l’action Demander des modifications ; regrouper les décideurs côté client.'],
 ['Troisième tour / nouvelle direction','Tour : pause et devis extra. Nouvelle direction : demande à qualifier, avec périmètre et prix confirmés.'],
 ['WhatsApp absent / compte déconnecté','Le client consulte le portail ; le studio vérifie les erreurs et contacts, puis rétablit le canal / la connexion concernée.'],
 ['Devis refusé, expiré ou à changer','Créer une nouvelle offre valable et faire accepter cette version avant de l’utiliser.'],
], [139,CW-139], compact=True)
section('Ce que l’application contrôle','Brouillons commerciaux privés ; documents envoyés figés ; décision explicite ; contrat cohérent avec son devis ; format / quantité du devis extra liés à la demande ; quota à l’acceptation d’une demande incluse ; pause du tour hors forfait sur contrat actif.','<b>Ce que le studio vérifie :</b> créations manuelles et imports, tâches anciennes sans format, qualité / droits, nouvelle direction, règlements, préparation avant démarrage et exceptions. Le pipeline est un guide ; tous ses passages ne sont pas des blocages automatiques.')
note('Décision claire','Chaque blocage doit finir par : une information reçue, une date confirmée, un devis accepté, un refus motivé ou une clôture convenue.')
nextpage()

# 16 - Daily actions / copy.
title('15 | Mode d’emploi quotidien','La routine qui tient la relation.','Un responsable côté agence, un contact qui consolide côté client et des décisions au bon endroit.')
grid(['AGENCE','CLIENT'],[
 ['<b>Chaque jour :</b> ouvrir Accueil / À traiter, tâches en cours, validations, demandes et échéances. Vérifier les publications attendues et incidents.', '<b>Chaque jour :</b> consulter À valider, répondre aux questions et surveiller les échéances des contenus reçus.'],
 ['<b>Chaque semaine :</b> vérifier le calendrier à venir, les informations manquantes, les volumes et les devis extras à envoyer / accepter.', '<b>Chaque semaine :</b> vérifier les événements, informations métier et changements à transmettre avant le gel du calendrier.'],
 ['<b>Chaque mois :</b> rapprocher forfait / extras / publications / paiements ; préparer bilan et nouvel accord si nécessaire.', '<b>Chaque mois :</b> lire le bilan, définir la suite, confirmer le prochain périmètre et régler les documents dus.'],
])
section('Trois messages prêts à adapter','<b>Accueil :</b> « Votre portail centralise les documents, le calendrier et les validations. Merci de désigner un contact qui regroupe vos retours. Les nouveaux besoins passent par Demander un contenu. »','<b>Extra :</b> « Cette demande dépasse le périmètre convenu de [quantité / format]. Nous avons préparé un devis de [quantité] [unités] à consulter dans Documents. Nous démarrons après votre acceptation explicite. »','<b>Validation :</b> « La version est disponible dans À valider. Merci de vérifier les informations et de confirmer, ou d’envoyer vos retours ensemble via Demander des modifications, dans le délai convenu. »')
section('Avant chaque nouveau client','Fiche et invitation correctes ; unités et prix précis ; TVA / Sans TVA choisi ; devis accepté ; contrat confirmé ; paiement prévu vérifié ; brief et accès prêts ; plan partagé ; tâches assignées ; règles de validation comprises.')
note('Le réflexe à retenir','<b>Un nouveau besoin = une demande.</b><br/><b>Un supplément payant = un devis accepté.</b><br/><b>Une décision sur un contenu = une validation traçable.</b><br/><b>Un renouvellement du périmètre = un nouvel accord.</b>')
flow.append(P('Guide fondé sur les parcours et contrôles actuels de The One Space. Les conditions commerciales sont à compléter avec vos vrais tarifs et les clauses convenues. Dernière revue : 02 octobre 2026.', 'small'))


def decoration(c, doc):
 c.saveState()
 c.setFillColor(GRAY);c.rect(0,0,W,H,fill=1,stroke=0)
 c.setFillColor(white);c.roundRect(23,29,W-46,H-58,13,fill=1,stroke=0)
 c.setFillColor(GOLD);c.roundRect(23,H-82,4,52,2,fill=1,stroke=0)
 c.setFont('Helvetica-Bold',8);c.setFillColor(HexColor('#765b14'));c.drawString(42,H-43,'THE ONE SPACE / AGENCE & CLIENT')
 c.setStrokeColor(LINE);c.line(42,43,W-42,43)
 c.setFont('Helvetica',8);c.setFillColor(MUTED);c.drawString(42,31,'GUIDE OPÉRATIONNEL  |  02 OCTOBRE 2026')
 c.drawRightString(W-42,31,f'{doc.page:02d} / {N:02d}')
 c.restoreState()

doc = SimpleDocTemplate(str(FILE),pagesize=A4,rightMargin=42,leftMargin=42,topMargin=66,bottomMargin=55,title='The One Space - Expérience agence et client de A à Z',author='The One Core')
doc.build(flow,onFirstPage=decoration,onLaterPages=decoration)
print(FILE)
