import os
import logging
from typing import List, Optional
from datetime import datetime

try:
    from git import Repo, Commit
    GIT_AVAILABLE = True
except ImportError:
    GIT_AVAILABLE = False

from predictor import NaiveBayesPredictor
from schemas import TrainingResult

logger = logging.getLogger(__name__)


class GitHistoryAnalyzer:
    def __init__(self, repo_path: str):
        self.repo_path = os.path.abspath(repo_path)
        self.predictor = NaiveBayesPredictor()
        self._repo = None

    def _get_repo(self) -> Optional[Repo]:
        if not GIT_AVAILABLE:
            raise ImportError("GitPython is not installed")
        if self._repo is None:
            if not os.path.exists(os.path.join(self.repo_path, ".git")):
                raise ValueError(f"Not a git repository: {self.repo_path}")
            self._repo = Repo(self.repo_path)
        return self._repo

    def get_commit_history(self, branch: str = "main", max_commits: int = 500,
                           file_extensions: Optional[List[str]] = None) -> List[List[str]]:
        if file_extensions is None:
            file_extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

        repo = self._get_repo()

        try:
            repo.remotes.origin.fetch()
        except Exception as e:
            logger.warning(f"Failed to fetch remote: {e}")

        try:
            branch_ref = f"origin/{branch}" if "origin/" not in branch else branch
            commits = list(repo.iter_commits(branch_ref, max_count=max_commits))
        except Exception as e:
            logger.warning(f"Failed to get commits from branch {branch}: {e}")
            commits = list(repo.iter_commits(max_count=max_commits))

        commit_files = []

        for commit in commits:
            if len(commit.parents) == 0:
                continue

            try:
                parent = commit.parents[0]
                diffs = parent.diff(commit)

                files_changed = set()

                for diff in diffs:
                    if diff.a_path:
                        file_path = diff.a_path
                        if any(file_path.endswith(ext) for ext in file_extensions):
                            files_changed.add(file_path)
                    if diff.b_path:
                        file_path = diff.b_path
                        if any(file_path.endswith(ext) for ext in file_extensions):
                            files_changed.add(file_path)

                if files_changed and len(files_changed) > 0:
                    commit_files.append(sorted(files_changed))

            except Exception as e:
                logger.debug(f"Error processing commit {commit.hexsha}: {e}")
                continue

        return commit_files

    def train_model(self, branch: str = "main", max_commits: int = 500) -> TrainingResult:
        commit_history = self.get_commit_history(branch=branch, max_commits=max_commits)
        result = self.predictor.train_from_commits(commit_history)
        result.repo_path = self.repo_path
        return result

    def predict_affected_files(self, modified_file: str, top_n: int = 5,
                                neo4j_client = None) -> dict:
        predictions = self.predictor.predict(modified_file, top_n=top_n)

        if neo4j_client and predictions.model_trained:
            predictions = self.predictor.combine_with_dependency_graph(
                predictions, neo4j_client, modified_file
            )

        return predictions

    def get_prediction(self, modified_file: str, top_n: int = 5) -> dict:
        return self.predictor.predict(modified_file, top_n=top_n)


predictor_cache: dict[str, GitHistoryAnalyzer] = {}


def get_or_create_predictor(repo_path: str) -> GitHistoryAnalyzer:
    abs_path = os.path.abspath(repo_path)
    if abs_path not in predictor_cache:
        predictor_cache[abs_path] = GitHistoryAnalyzer(abs_path)
    return predictor_cache[abs_path]


def clear_predictor_cache():
    predictor_cache.clear()
