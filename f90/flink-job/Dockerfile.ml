FROM maven:3.9-eclipse-temurin-11 AS build
WORKDIR /app
COPY pom.xml .
COPY ../pom.xml ../pom.xml
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn package -DskipTests -B

FROM eclipse-temurin:11-jre-alpine
WORKDIR /app
COPY --from=build /app/target/flink-job-1.0.0.jar app.jar
ENTRYPOINT ["java"]
