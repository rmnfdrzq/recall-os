# AY-25-26-examples
Examples for A.Y. 2025/26

##Design Principles

The Java source code contains examples of the 5 design principles:

- Single Responsibility Principle (SRP)
- Open-Closed Principle (OCP)
- Liskov Subsitution Principle (LSP)
- Interface Segregation Principle (ISP)
- Dependency Inversion Principle (DIP)

For each package, you will find subpackages related to code with violations of the principle (`*\_viol`) and the corresponding refactored, compliant version (`*\_refactor*`).

The project is structured as a maven project: 

- You can run `mvn clean compile` to compile the project 
- With `mvn clean compile site`  to automatically produce documentation with UML diagrams (see target/site/index.html). 
- Change `<scanPackage>` value inside `generate-puml` task in the `pom.xml` to change the scope of UML diagram generation.

You can also compile the code directly in your IDE (we recommend Visual Studio Code).


 