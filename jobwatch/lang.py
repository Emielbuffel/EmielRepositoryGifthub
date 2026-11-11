"""Tiny language guess for vacancy titles and summaries (en / fr / es / nl)."""
import re

WORDS = {
    "fr": r"le|la|les|des|du|au|aux|et|pour|chargée?|chargé\(e\)|responsable|coordinat(?:eur|rice)|coordonnat(?:eur|rice)|spécialiste|"
          r"conseill(?:er|ère)|gestionnaire|ingénieur|appui|suivi|projet|expert\(e\)|expert\.e|assistant\(e\)|d'|l'|sur|dans|avec|"
          r"chef|adjoint|agent|trésori(?:er|ère)|secrétaire|direct(?:eur|rice)|secteur|privée?|formation|insertion|professionnelle|logistique|comptable|programme\s+de|évaluation|environnement|développement|élaboration|renforcement|mise\s+en\s+œuvre",
    "es": r"el|los|las|y|del|para|con|oficial|especialista|asistente|consultor(?:a|ía)?|coordinador(?:a)?|técnico|técnica|"
          r"evaluación|gestión|proyecto|programa|desarrollo|medio\s+ambiente|apoyo|seguimiento|elaboración|fortalecimiento|nacional",
    "nl": r"de|het|een|en|van|voor|met|medewerker|beleidsmedewerker|deskundige|adviseur|verantwoordelijke|teamverantwoordelijke|"
          r"vlaamse|departement|agentschap",
    "en": r"the|and|of|for|with|officer|specialist|assistant|consultant|coordinator|analyst|manager|expert|project|programme|program|support",
}
PATS = {k: re.compile(r"(?<![\w'])(?:" + v + r")(?![\w])", re.I) for k, v in WORDS.items()}


def guess(text):
    t = (text or "").lower()
    score = {k: len(p.findall(t)) for k, p in PATS.items()}
    if re.search(r"[èêàçùûîïœ]", t):
        score["fr"] += 2
    if re.search(r"\w\.(?:e|te|rice|ère)\b|\w\((?:e|te|rice)\)", t):  # French inclusive writing: Expert.e, Assistant(e)
        score["fr"] += 3
    if re.search(r"é\b|\bé|é[^ns]", t) and not re.search(r"ó|á|ñ|ción", t):
        score["fr"] += 1
    if re.search(r"[ñ¿¡]|ción\b|ciones\b", t):
        score["es"] += 2
    best = max(score, key=score.get)
    if score[best] == 0:
        return "en"
    # shared words (programme, project, expert) make English the safe tie-break
    if best != "en" and score[best] <= score["en"]:
        return "en"
    return best
