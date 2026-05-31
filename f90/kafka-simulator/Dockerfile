FROM maven:3.9-eclipse-temurin-11 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn package -DskipTests -B

FROM eclipse-temurin:11-jre-alpine
WORKDIR /app
COPY --from=build /app/target/kafka-simulator-1.0.0.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
CMD ["${KAFKA_BROKERS:localhost:9092}", "${KAFKA_TOPIC:transactions}", "${SIMULATION_DURATION:600000}", "${RATE_PER_SECOND:10}"]
