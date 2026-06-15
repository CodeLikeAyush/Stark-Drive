package com.family.drive.controller;

import com.family.drive.dto.AlbumRequest;
import com.family.drive.dto.AlbumSummaryResponse;
import com.family.drive.dto.AlbumDetailsResponse;
import com.family.drive.dto.AddPhotosRequest;
import com.family.drive.model.User;
import com.family.drive.service.AlbumService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/albums")
public class AlbumController {

    private final AlbumService service;

    public AlbumController(AlbumService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<AlbumDetailsResponse> createAlbum(@RequestBody AlbumRequest request, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(service.createAlbum(request, user));
    }

    @GetMapping
    public ResponseEntity<List<AlbumSummaryResponse>> listAlbums(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(service.listAlbums(user));
    }

    @GetMapping("/{id}")
    public ResponseEntity<AlbumDetailsResponse> getAlbumDetails(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(service.getAlbumDetails(id, user));
    }

    @PostMapping("/{id}/photos")
    public ResponseEntity<AlbumDetailsResponse> addPhotosToAlbum(@PathVariable Long id, @RequestBody AddPhotosRequest request, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(service.addPhotos(id, request, user));
    }

    @DeleteMapping("/{id}/photos")
    public ResponseEntity<AlbumDetailsResponse> removePhotosFromAlbum(@PathVariable Long id, @RequestBody AddPhotosRequest request, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(service.removePhotos(id, request, user));
    }

    @PutMapping("/{id}")
    public ResponseEntity<AlbumDetailsResponse> updateAlbum(@PathVariable Long id, @RequestBody AlbumRequest request, @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(service.updateAlbum(id, request, user));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteAlbum(@PathVariable Long id, @AuthenticationPrincipal User user) {
        service.deleteAlbum(id, user);
        return ResponseEntity.ok().build();
    }
}
