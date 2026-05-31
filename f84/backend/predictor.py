import os
import math
import logging
from collections import defaultdict, Counter
from typing import Optional, List, Dict, Tuple
from datetime import datetime

from schemas import CoChangePattern, PredictionItem, PredictionResponse, TrainingResult

logger = logging.getLogger(__name__)


class NaiveBayesPredictor:
    def __init__(self):
        self.file_change_count: Counter[str] = Counter()
        self.co_change_count: Dict[str, Counter[str]] = defaultdict(Counter)
        self.total_commits: int = 0
        self.total_files: int = 0
        self.commit_history: List[set] = []
        self.all_files: set = set()
        self.is_trained: bool = False

    def reset(self):
        self.file_change_count.clear()
        self.co_change_count.clear()
        self.commit_history.clear()
        self.all_files.clear()
        self.total_commits = 0
        self.total_files = 0
        self.is_trained = False

    def train_from_commits(self, commits: List[List[str]]) -> TrainingResult:
        self.reset()
        self.total_commits = len(commits)

        for commit_files in commits:
            if not commit_files:
                continue

            file_set = set(commit_files)
            self.commit_history.append(file_set)
            self.all_files.update(file_set)

            for file in file_set:
                self.file_change_count[file] += 1

            for file_a in file_set:
                for file_b in file_set:
                    if file_a != file_b:
                        self.co_change_count[file_a][file_b] += 1

        self.total_files = len(self.all_files)
        self.is_trained = True

        co_change_patterns = sum(
            len(counter) for counter in self.co_change_count.values()
        ) // 2

        return TrainingResult(
            repo_path="",
            total_commits=self.total_commits,
            total_files=self.total_files,
            co_change_patterns=co_change_patterns,
            status="success",
            message=f"模型训练完成，分析了 {self.total_commits} 个提交，{self.total_files} 个文件"
        )

    def _prior_probability(self, file: str) -> float:
        if self.total_commits == 0:
            return 0.0
        return self.file_change_count.get(file, 0) / self.total_commits

    def _conditional_probability(self, modified_file: str, target_file: str) -> float:
        modified_count = self.file_change_count.get(modified_file, 0)
        if modified_count == 0:
            return 0.0
        co_changed = self.co_change_count[modified_file].get(target_file, 0)
        return co_changed / modified_count

    def _naive_bayes_probability(self, modified_file: str, target_file: str) -> Tuple[float, float, int]:
        if modified_file == target_file:
            return 0.0, 0.0, 0

        co_change_count = self.co_change_count[modified_file].get(target_file, 0)
        if co_change_count == 0:
            return 0.0, 0.0, 0

        P_B = self._prior_probability(target_file)
        P_A_given_B = self._conditional_probability(modified_file, target_file)
        P_A = self._prior_probability(modified_file)

        if P_A == 0:
            return 0.0, 0.0, co_change_count

        P_B_given_A = (P_A_given_B * P_B) / P_A

        modified_total = self.file_change_count.get(modified_file, 0)
        confidence = co_change_count / max(modified_total, 1) if modified_total > 0 else 0

        return P_B_given_A, confidence, co_change_count

    def predict(self, modified_file: str, top_n: int = 5) -> PredictionResponse:
        if not self.is_trained:
            return PredictionResponse(
                modified_file=modified_file,
                predictions=[],
                total_commits_analyzed=self.total_commits,
                model_trained=False
            )

        candidates = []

        for target_file in self.all_files:
            if target_file == modified_file:
                continue

            probability, confidence, co_change_count = self._naive_bayes_probability(
                modified_file, target_file
            )

            if probability > 0 or confidence > 0:
                reason_parts = []
                if co_change_count > 0:
                    reason_parts.append(f"共同修改 {co_change_count} 次")
                if confidence > 0.5:
                    reason_parts.append(f"强关联 ({confidence:.1%})")

                candidates.append(PredictionItem(
                    file=target_file,
                    probability=round(probability, 4),
                    confidence=round(confidence, 4),
                    co_change_count=co_change_count,
                    reason="; ".join(reason_parts) if reason_parts else "历史共同修改"
                ))

        candidates.sort(key=lambda x: (x.probability * x.confidence), reverse=True)
        top_predictions = candidates[:top_n]

        return PredictionResponse(
            modified_file=modified_file,
            predictions=top_predictions,
            total_commits_analyzed=self.total_commits,
            model_trained=True
        )

    def get_co_change_patterns(self, min_count: int = 2) -> List[CoChangePattern]:
        patterns = []
        seen = set()

        for file_a, counter in self.co_change_count.items():
            for file_b, count in counter.items():
                if count >= min_count:
                    pair = tuple(sorted([file_a, file_b]))
                    if pair not in seen:
                        seen.add(pair)
                        confidence = count / max(self.file_change_count.get(file_a, 1), 1)
                        patterns.append(CoChangePattern(
                            file_a=file_a,
                            file_b=file_b,
                            co_change_count=count,
                            total_commits=self.total_commits,
                            confidence=round(confidence, 4)
                        ))

        patterns.sort(key=lambda x: x.co_change_count, reverse=True)
        return patterns

    def combine_with_dependency_graph(self, predictions: PredictionResponse,
                                       neo4j_client,
                                       file_path: str) -> PredictionResponse:
        if not predictions.model_trained:
            return predictions

        deps = neo4j_client.get_references(file_path)
        dep_files = {r["file"] for r in deps}

        enhanced = []
        for pred in predictions.predictions:
            bonus = 1.0
            reasons = [pred.reason]

            if pred.file in dep_files:
                bonus = 1.5
                reasons.append("存在直接依赖关系")

            enhanced.append(PredictionItem(
                file=pred.file,
                probability=round(min(1.0, pred.probability * bonus), 4),
                confidence=round(min(1.0, pred.confidence * bonus), 4),
                co_change_count=pred.co_change_count,
                reason="; ".join(reasons)
            ))

        enhanced.sort(key=lambda x: (x.probability * x.confidence), reverse=True)
        predictions.predictions = enhanced[:len(predictions.predictions)]

        return predictions
