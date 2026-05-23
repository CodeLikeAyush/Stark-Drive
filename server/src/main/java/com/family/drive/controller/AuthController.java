package com.family.drive.controller;

import com.family.drive.dto.AuthRequest;
import com.family.drive.dto.AuthResponse;
import com.family.drive.dto.RegisterRequest;
import com.family.drive.dto.UpdateNameRequest;
import com.family.drive.model.User;
import com.family.drive.service.AuthenticationService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthenticationService service;

    public AuthController(AuthenticationService service) {
        this.service = service;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@RequestBody RegisterRequest request) {
        return ResponseEntity.ok(service.register(request));
    }

    @PostMapping("/authenticate")
    public ResponseEntity<AuthResponse> authenticate(@RequestBody AuthRequest request) {
        return ResponseEntity.ok(service.authenticate(request));
    }

    @PutMapping("/name")
    public ResponseEntity<Void> updateName(@RequestBody UpdateNameRequest request, @AuthenticationPrincipal User user) {
        service.updateName(request, user);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/vault-setup")
    public ResponseEntity<Void> setupVault(@AuthenticationPrincipal User user) {
        service.setupVault(user);
        return ResponseEntity.ok().build();
    }

    @org.springframework.web.bind.annotation.GetMapping("/ping")
    public ResponseEntity<String> ping() {
        return ResponseEntity.ok("pong");
    }
}
