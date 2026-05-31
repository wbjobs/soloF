import re
import requests
import time
from typing import List, Dict, Optional, Set
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed


@dataclass
class Citation:
    raw_text: str
    citation_type: str
    ref_number: Optional[int] = None
    author: Optional[str] = None
    year: Optional[str] = None
    doi: Optional[str] = None
    title: Optional[str] = None
    abstract: Optional[str] = None
    authors: Optional[List[str]] = None
    journal: Optional[str] = None
    bibtex: Optional[str] = None


class CitationParser:
    def __init__(self):
        self.numeric_pattern = re.compile(r'\[(\d+)\]')
        self.author_year_pattern = re.compile(r'\(([A-Z][a-z]+)\s*,\s*(\d{4})\)')
        self.multi_citation_pattern = re.compile(r'\[(\d+(?:,\s*\d+)*)\]')
    
    def parse_text(self, text: str) -> List[Citation]:
        citations = []
        seen = set()
        
        for match in self.numeric_pattern.finditer(text):
            ref_num = int(match.group(1))
            key = f"numeric_{ref_num}"
            if key not in seen:
                seen.add(key)
                citations.append(Citation(
                    raw_text=match.group(0),
                    citation_type="numeric",
                    ref_number=ref_num
                ))
        
        for match in self.author_year_pattern.finditer(text):
            author = match.group(1)
            year = match.group(2)
            key = f"authoryear_{author}_{year}"
            if key not in seen:
                seen.add(key)
                citations.append(Citation(
                    raw_text=match.group(0),
                    citation_type="author_year",
                    author=author,
                    year=year
                ))
        
        return citations


class CrossRefClient:
    def __init__(self, email: str = "research@example.com", timeout: int = 10):
        self.base_url = "https://api.crossref.org"
        self.email = email
        self.timeout = timeout
        self.headers = {
            "User-Agent": f"CitationProcessor/1.0 (mailto:{email})"
        }
    
    def _make_request(self, endpoint: str, params: Dict = None) -> Optional[Dict]:
        try:
            url = f"{self.base_url}/{endpoint}"
            response = requests.get(url, headers=self.headers, params=params, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"CrossRef API error: {e}")
            return None
    
    def search_by_doi(self, doi: str) -> Optional[Dict]:
        result = self._make_request(f"works/{doi}")
        return result.get("message") if result else None
    
    def search_by_author_year(self, author: str, year: str, limit: int = 5) -> List[Dict]:
        params = {
            "query.author": author,
            "query.bibliographic": year,
            "rows": limit,
            "select": "DOI,title,abstract,author,container-title,published-print"
        }
        result = self._make_request("works", params)
        return result.get("message", {}).get("items", []) if result else []
    
    def search_by_title(self, title: str, limit: int = 5) -> List[Dict]:
        params = {
            "query.title": title,
            "rows": limit,
            "select": "DOI,title,abstract,author,container-title,published-print"
        }
        result = self._make_request("works", params)
        return result.get("message", {}).get("items", []) if result else []


class BibTeXGenerator:
    @staticmethod
    def _get_author_list(authors: List[Dict]) -> str:
        author_names = []
        for author in authors:
            given = author.get("given", "")
            family = author.get("family", "")
            if family:
                if given:
                    author_names.append(f"{family}, {given}")
                else:
                    author_names.append(family)
        return " and ".join(author_names)
    
    @staticmethod
    def _get_year(published: Dict) -> str:
        try:
            if published and "date-parts" in published:
                date_parts = published["date-parts"]
                if date_parts and len(date_parts) > 0 and len(date_parts[0]) > 0:
                    return str(date_parts[0][0])
        except:
            pass
        return "2024"
    
    @staticmethod
    def generate(crossref_data: Dict) -> str:
        doi = crossref_data.get("DOI", "")
        entry_type = "article"
        
        title = crossref_data.get("title", [""])[0] if crossref_data.get("title") else ""
        authors = BibTeXGenerator._get_author_list(crossref_data.get("author", []))
        journal = crossref_data.get("container-title", [""])[0] if crossref_data.get("container-title") else ""
        year = BibTeXGenerator._get_year(crossref_data.get("published-print", {}))
        
        first_author = crossref_data.get("author", [{}])[0].get("family", "Unknown") if crossref_data.get("author") else "Unknown"
        key = f"{first_author.lower()}{year}"
        
        bibtex = f"@{entry_type}{{{key},\n"
        bibtex += f"  title = {{{title}}},\n"
        bibtex += f"  author = {{{authors}}},\n"
        bibtex += f"  journal = {{{journal}}},\n"
        bibtex += f"  year = {{{year}}},\n"
        bibtex += f"  doi = {{{doi}}},\n"
        bibtex += f"}}\n"
        
        return bibtex


class CitationProcessor:
    def __init__(self):
        self.parser = CitationParser()
        self.crossref_client = CrossRefClient()
        self.bibtex_generator = BibTeXGenerator()
    
    def process_text(self, text: str, max_workers: int = 3) -> Dict:
        citations = self.parser.parse_text(text)
        
        unique_citations = {}
        for citation in citations:
            if citation.citation_type == "numeric":
                key = f"num_{citation.ref_number}"
            else:
                key = f"ay_{citation.author}_{citation.year}"
            unique_citations[key] = citation
        
        enriched_citations = []
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_citation = {}
            
            for citation in unique_citations.values():
                if citation.citation_type == "author_year" and citation.author and citation.year:
                    future = executor.submit(
                        self.crossref_client.search_by_author_year,
                        citation.author,
                        citation.year
                    )
                    future_to_citation[future] = citation
            
            for future in as_completed(future_to_citation):
                citation = future_to_citation[future]
                try:
                    results = future.result()
                    if results:
                        best_match = results[0]
                        citation.doi = best_match.get("DOI")
                        citation.title = best_match.get("title", [""])[0] if best_match.get("title") else ""
                        citation.abstract = best_match.get("abstract", "")
                        citation.authors = [
                            f"{a.get('given', '')} {a.get('family', '')}".strip()
                            for a in best_match.get("author", [])
                        ]
                        citation.journal = best_match.get("container-title", [""])[0] if best_match.get("container-title") else ""
                        citation.bibtex = self.bibtex_generator.generate(best_match)
                except Exception as e:
                    print(f"Error enriching citation {citation.raw_text}: {e}")
                
                enriched_citations.append(citation)
                time.sleep(0.1)
        
        numeric_citations = [c for c in enriched_citations if c.citation_type == "numeric"]
        authoryear_citations = [c for c in enriched_citations if c.citation_type == "author_year"]
        
        numeric_citations.sort(key=lambda c: c.ref_number if c.ref_number else 0)
        
        return {
            "all_citations": numeric_citations + authoryear_citations,
            "count": len(enriched_citations),
            "with_doi": len([c for c in enriched_citations if c.doi])
        }
    
    def generate_references_section(self, citations: List[Citation]) -> str:
        if not citations:
            return ""
        
        section = "\n\n## 📚 参考文献\n\n"
        
        section += "### BibTeX 条目\n\n```bibtex\n"
        for citation in citations:
            if citation.bibtex:
                section += citation.bibtex + "\n"
        section += "```\n\n"
        
        section += "### 详细信息\n\n"
        for i, citation in enumerate(citations, 1):
            section += f"#### {i}. {citation.title or '未找到文献信息'}\n\n"
            
            if citation.authors:
                section += f"**作者**: {', '.join(citation.authors[:3])}"
                if len(citation.authors) > 3:
                    section += f" 等 {len(citation.authors)} 人"
                section += "\n\n"
            
            if citation.journal:
                section += f"**期刊**: {citation.journal}\n\n"
            
            if citation.doi:
                section += f"**DOI**: [{citation.doi}](https://doi.org/{citation.doi})\n\n"
            
            if citation.abstract:
                section += f"**摘要**: {citation.abstract[:500]}"
                if len(citation.abstract) > 500:
                    section += "..."
                section += "\n\n"
            
            section += "---\n\n"
        
        return section


citation_processor = CitationProcessor()
