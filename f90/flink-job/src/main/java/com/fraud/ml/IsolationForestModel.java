package com.fraud.ml;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public class IsolationForestModel implements Serializable {
    private static final long serialVersionUID = 1L;

    private List<IsolationTree> trees;
    private int numTrees;
    private int sampleSize;
    private int maxDepth;
    private double anomalyThreshold;
    private long totalSamples;
    private Random random;

    public IsolationForestModel() {
        this(100, 256, 0.7, 42);
    }

    public IsolationForestModel(int numTrees, int sampleSize, double anomalyThreshold, long seed) {
        this.numTrees = numTrees;
        this.sampleSize = sampleSize;
        this.maxDepth = (int) Math.ceil(Math.log(sampleSize) / Math.log(2));
        this.anomalyThreshold = anomalyThreshold;
        this.totalSamples = 0;
        this.random = new Random(seed);
        this.trees = new ArrayList<>();
    }

    public void initialize(double[][] initialSamples, boolean[] labels) {
        trees.clear();
        for (int i = 0; i < numTrees; i++) {
            double[][] sample = bootstrapSample(initialSamples, sampleSize, random);
            IsolationTree tree = new IsolationTree(maxDepth, random.nextLong());
            tree.build(sample, labels);
            trees.add(tree);
        }
        totalSamples = initialSamples.length;
    }

    public void updateIncremental(double[][] newSamples, boolean[] labels) {
        if (newSamples.length == 0) return;

        int treesToReplace = Math.min(numTrees, Math.max(1, (int) (numTrees * 0.1)));
        for (int i = 0; i < treesToReplace; i++) {
            int treeIndex = random.nextInt(numTrees);
            double[][] sample = bootstrapSample(newSamples, Math.min(sampleSize, newSamples.length), random);
            boolean[] sampleLabels = bootstrapLabels(labels, Math.min(sampleSize, newSamples.length), random);
            IsolationTree tree = new IsolationTree(maxDepth, random.nextLong());
            tree.build(sample, sampleLabels);
            trees.set(treeIndex, tree);
        }
        totalSamples += newSamples.length;
    }

    public double predictAnomalyScore(double[] features) {
        if (trees.isEmpty()) {
            return 0.0;
        }

        double avgPathLength = 0;
        for (IsolationTree tree : trees) {
            avgPathLength += tree.pathLength(features);
        }
        avgPathLength /= trees.size();

        double expectedPathLength = computeExpectedPathLength(sampleSize);
        double anomalyScore = Math.pow(2, -avgPathLength / expectedPathLength);

        return anomalyScore;
    }

    public boolean isAnomaly(double[] features) {
        return predictAnomalyScore(features) >= anomalyThreshold;
    }

    public double getAnomalyThreshold() {
        return anomalyThreshold;
    }

    public void setAnomalyThreshold(double threshold) {
        this.anomalyThreshold = threshold;
    }

    public long getTotalSamples() {
        return totalSamples;
    }

    public int getNumTrees() {
        return numTrees;
    }

    private double[][] bootstrapSample(double[][] data, int size, Random rnd) {
        double[][] sample = new double[size][];
        for (int i = 0; i < size; i++) {
            int index = rnd.nextInt(data.length);
            sample[i] = data[index].clone();
        }
        return sample;
    }

    private boolean[] bootstrapLabels(boolean[] labels, int size, Random rnd) {
        boolean[] sample = new boolean[size];
        for (int i = 0; i < size; i++) {
            int index = rnd.nextInt(labels.length);
            sample[i] = labels[index];
        }
        return sample;
    }

    private double computeExpectedPathLength(int n) {
        if (n <= 1) return 0;
        return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1) / n);
    }

    public static class IsolationTree implements Serializable {
        private static final long serialVersionUID = 1L;

        private TreeNode root;
        private int maxDepth;
        private long seed;

        public IsolationTree(int maxDepth, long seed) {
            this.maxDepth = maxDepth;
            this.seed = seed;
        }

        public void build(double[][] data, boolean[] labels) {
            Random rnd = new Random(seed);
            root = buildTree(data, labels, 0, rnd);
        }

        private TreeNode buildTree(double[][] data, boolean[] labels, int depth, Random rnd) {
            if (depth >= maxDepth || data.length <= 1 || isPure(labels)) {
                return new LeafNode(data.length);
            }

            int numFeatures = data[0].length;
            int featureIndex = rnd.nextInt(numFeatures);

            double minVal = Double.MAX_VALUE;
            double maxVal = Double.MIN_VALUE;
            for (double[] row : data) {
                minVal = Math.min(minVal, row[featureIndex]);
                maxVal = Math.max(maxVal, row[featureIndex]);
            }

            if (minVal == maxVal) {
                return new LeafNode(data.length);
            }

            double splitValue = minVal + rnd.nextDouble() * (maxVal - minVal);

            List<double[]> leftData = new ArrayList<>();
            List<double[]> rightData = new ArrayList<>();
            List<Boolean> leftLabels = new ArrayList<>();
            List<Boolean> rightLabels = new ArrayList<>();

            for (int i = 0; i < data.length; i++) {
                if (data[i][featureIndex] < splitValue) {
                    leftData.add(data[i]);
                    leftLabels.add(labels[i]);
                } else {
                    rightData.add(data[i]);
                    rightLabels.add(labels[i]);
                }
            }

            if (leftData.isEmpty() || rightData.isEmpty()) {
                return new LeafNode(data.length);
            }

            double[][] leftArr = leftData.toArray(new double[0][]);
            double[][] rightArr = rightData.toArray(new double[0][]);
            boolean[] leftLabelsArr = new boolean[leftLabels.size()];
            boolean[] rightLabelsArr = new boolean[rightLabels.size()];
            for (int i = 0; i < leftLabels.size(); i++) leftLabelsArr[i] = leftLabels.get(i);
            for (int i = 0; i < rightLabels.size(); i++) rightLabelsArr[i] = rightLabels.get(i);

            SplitNode node = new SplitNode(featureIndex, splitValue);
            node.left = buildTree(leftArr, leftLabelsArr, depth + 1, rnd);
            node.right = buildTree(rightArr, rightLabelsArr, depth + 1, rnd);

            return node;
        }

        private boolean isPure(boolean[] labels) {
            if (labels.length == 0) return true;
            boolean first = labels[0];
            for (boolean label : labels) {
                if (label != first) return false;
            }
            return true;
        }

        public double pathLength(double[] features) {
            return pathLength(root, features, 0);
        }

        private double pathLength(TreeNode node, double[] features, int currentDepth) {
            if (node instanceof LeafNode) {
                LeafNode leaf = (LeafNode) node;
                return currentDepth + computeExpectedPathLength(leaf.size);
            }

            SplitNode split = (SplitNode) node;
            if (features[split.featureIndex] < split.splitValue) {
                return pathLength(split.left, features, currentDepth + 1);
            } else {
                return pathLength(split.right, features, currentDepth + 1);
            }
        }

        private double computeExpectedPathLength(int n) {
            if (n <= 1) return 0;
            return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1) / n);
        }
    }

    public interface TreeNode extends Serializable {}

    public static class SplitNode implements TreeNode {
        private static final long serialVersionUID = 1L;

        public int featureIndex;
        public double splitValue;
        public TreeNode left;
        public TreeNode right;

        public SplitNode(int featureIndex, double splitValue) {
            this.featureIndex = featureIndex;
            this.splitValue = splitValue;
        }
    }

    public static class LeafNode implements TreeNode {
        private static final long serialVersionUID = 1L;

        public int size;

        public LeafNode(int size) {
            this.size = size;
        }
    }

    public static class LabeledSample implements Serializable {
        private static final long serialVersionUID = 1L;

        public double[] features;
        public boolean isAnomaly;
        public long timestamp;

        public LabeledSample(double[] features, boolean isAnomaly) {
            this.features = features;
            this.isAnomaly = isAnomaly;
            this.timestamp = System.currentTimeMillis();
        }
    }
}
